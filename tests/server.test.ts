import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../server/app.js';
import { snapshotDatabase } from '../server/database.js';
import { roomSchema, type Command, type Room, type RoomReply } from '../shared/protocol.js';

// Make the server's crypto provider deterministic only for dice, not identities or invitations.
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: (min: number, max?: number) => max === 7 ? 6 : actual.randomInt(min),
  };
});

type App = ReturnType<typeof createServer>;
type Guest = { socket: Socket; cookie: string; you: string };
let app: App;
let url: string;
let directory: string;
let databasePath: string;
const sockets: Socket[] = [];
// Windows can allocate ephemeral ports that Fetch intentionally blocks.
const blockedPorts = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

async function start(extra: Partial<Parameters<typeof createServer>[0]> = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    app = createServer({ databasePath, graceMs: 90, botDelayMs: 10_000, ...extra });
    const port = await app.listen();
    if (port < 1024 || blockedPorts.has(port)) { await app.close(); continue; }
    url = `http://127.0.0.1:${port}`;
    return;
  }
  throw new Error('Unable to allocate a Fetch-safe test port.');
}
async function guest(cookie?: string): Promise<Guest> {
  const res = await fetch(`${url}/api/session`, { headers: cookie ? { Cookie: cookie } : {} });
  expect(res.status).toBe(200);
  const { you } = await res.json() as { you: string };
  const returned = res.headers.get('set-cookie');
  if (!cookie) {
    expect(returned).toContain('HttpOnly');
    expect(returned).toContain('SameSite=Lax');
  }
  const credential = cookie ?? returned!.split(';')[0];
  const socket = io(url, {
    transports: ['websocket'], extraHeaders: { Cookie: credential, Origin: url },
    reconnection: false, autoConnect: false,
  });
  sockets.push(socket);
  await new Promise<void>((done, fail) => {
    socket.once('connect', done);
    socket.once('connect_error', fail);
    socket.connect();
  });
  return { socket, cookie: credential, you };
}
function emit(socket: Socket, event: string, input: unknown): Promise<RoomReply> {
  return new Promise((done, fail) => {
    socket.timeout(2000).emit(event, input, (error: Error | null, reply: RoomReply) => error ? fail(error) : done(reply));
  });
}
function room(reply: RoomReply) {
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw new Error(reply.error);
  roomSchema.parse(reply.value.room);
  return reply.value.room;
}
async function create(g: Guest, preset: Room['preset'] = 'ludo', name = 'Bunny') {
  return room(await emit(g.socket, 'create', { protocol: 1, requestId: randomUUID(), preset, name, avatar: 'fox' }));
}
async function join(g: Guest, invitation: string, name = 'Friend') {
  return room(await emit(g.socket, 'join', { protocol: 1, invitation, name, avatar: 'frog' }));
}
type Action = Command extends infer C ? C extends Command ? Omit<C, 'requestId' | 'revision'> : never : never;
async function act(g: Guest, state: Room, action: Action) {
  return emit(g.socket, 'command', {
    roomId: state.id, requestId: randomUUID(), revision: state.revision, ...action,
  });
}
async function playing(a: Guest, b: Guest, preset: Room['preset'] = 'ludo') {
  let state = await create(a, preset);
  state = await join(b, state.invite);
  state = room(await act(a, state, { type: 'ready', ready: true }));
  state = room(await act(b, state, { type: 'ready', ready: true }));
  return room(await act(a, state, { type: 'start' }));
}
async function waitFor(check: () => Promise<boolean>, timeout = 1500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error('Timed out waiting for room policy.');
}
beforeEach(async () => {
  directory = resolve(`.server-test-${randomUUID()}`);
  mkdirSync(directory);
  databasePath = resolve(directory, 'test.sqlite');
  await start();
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('authoritative room server', () => {
  it('uses opaque HttpOnly credentials, stable public IDs, multiple tabs, and distinct seat names', async () => {
    const a = await guest();
    const same = await guest(a.cookie);
    const b = await guest();
    expect(same.you).toBe(a.you);
    expect(b.you).not.toBe(a.you);
    let state = await create(a, 'ludo', 'abcdefghijklmnopqrst');
    state = await join(same, state.code);
    expect(state.seats).toHaveLength(1);
    expect(state.seats[0]).toMatchObject({ id: a.you, avatar: 'fox' });
    state = await join(b, state.invite, 'abcdefghijklmnopqrst');
    expect(state.seats[1].name).toBe('abcdefghijklmnopqr 2');
    expect(state.seats[1].avatar).toBe('frog');
    expect(JSON.stringify(state)).not.toContain(a.cookie.split('=')[1]);
    a.socket.disconnect();
    state = await join(b, state.invite);
    expect(state.seats.find(s => s.id === a.you)?.online).toBe(true);
    same.socket.disconnect();
    await waitFor(async () => !(await join(b, state.invite)).seats.find(s => s.id === a.you)?.online);
  });

  it('requires human readiness and host start; rejects stale, out-of-turn, invalid and client-valued dice commands', async () => {
    const a = await guest(), b = await guest();
    let state = await create(a);
    state = await join(b, state.invite);
    expect(await act(a, state, { type: 'start' })).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(await act(b, state, { type: 'start' })).toMatchObject({ ok: false, code: 'HOST_ONLY' });
    const stale = state;
    state = room(await act(a, state, { type: 'ready', ready: true }));
    const staleReply = await act(b, stale, { type: 'ready', ready: true });
    expect(staleReply).toMatchObject({ ok: false, code: 'STALE_REVISION', room: { revision: state.revision } });
    if (!staleReply.ok) roomSchema.parse(staleReply.room);
    state = room(await act(b, state, { type: 'ready', ready: true }));
    state = room(await act(a, state, { type: 'start' }));
    expect(state.game?.players.map(s => s.id)).toEqual([a.you, b.you]);
    expect(await act(b, state, { type: 'roll' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(await emit(a.socket, 'command', {
      roomId: state.id, type: 'roll', value: 6, requestId: randomUUID(), revision: state.revision,
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    state = room(await act(a, state, { type: 'roll' }));
    expect(state.game).toMatchObject({ dice: 6, phase: 'move' });
    expect(await act(a, state, { type: 'roll' })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(await act(a, state, { type: 'bot', add: true })).toMatchObject({ ok: false, code: 'MATCH_STARTED' });
    state = room(await act(a, state, { type: 'move', token: 0 }));
    expect(state.game?.positions[0][0]).toBe(0);
  });

  it('persists exact pending dice and bounded deduplication before ACK across restart', async () => {
    const a = await guest(), b = await guest();
    let state = await playing(a, b);
    const request = { roomId: state.id, type: 'roll', requestId: randomUUID(), revision: state.revision };
    const committed = await emit(a.socket, 'command', request);
    state = room(committed);
    expect(state.game).toMatchObject({ phase: 'move', dice: 6 });
    expect(await emit(a.socket, 'command', request)).toEqual(committed);
    expect(await emit(a.socket, 'command', { ...request, type: 'move', token: 0 }))
      .toMatchObject({ ok: false, code: 'REQUEST_CONFLICT' });
    await app.close();
    await start();
    const restored = await guest(a.cookie);
    expect(restored.you).toBe(a.you);
    const snapshot = await join(restored, state.invite);
    expect(snapshot.game).toEqual(state.game);
    expect(snapshot.revision).toBe(state.revision);
    expect(await emit(restored.socket, 'command', request)).toEqual(committed);
    const moved = room(await act(restored, snapshot, { type: 'move', token: 0 }));
    expect(moved.game?.positions[0][0]).toBe(0);
    const db = new DatabaseSync(databasePath);
    const row = db.prepare('SELECT snapshot FROM rooms WHERE id=?').get(state.id) as { snapshot: string };
    expect(JSON.parse(row.snapshot).game).toEqual(moved.game);
    db.close();
  });

  it('commits a roll once even when its first acknowledgement is lost', async () => {
    const a = await guest(), b = await guest();
    let state = await playing(a, b);
    const request = { roomId: state.id, type: 'roll', requestId: randomUUID(), revision: state.revision };
    const broadcast = new Promise<Room>(done => {
      const onRoom = (next: Room) => {
        if (next.id === state.id && next.revision > state.revision) {
          a.socket.off('room', onRoom);
          done(next);
        }
      };
      a.socket.on('room', onRoom);
    });
    a.socket.emit('command', request, () => { /* Simulate a dropped acknowledgement. */ });
    state = await broadcast;
    expect(state.game).toMatchObject({ dice: 6, phase: 'move' });
    const retried = room(await emit(a.socket, 'command', request));
    expect(retried.revision).toBe(state.revision);
    expect(retried.game).toEqual(state.game);
  });

  it('rolls back snapshot and dedupe together on storage failure and explicitly reports degradation', async () => {
    const a = await guest(), b = await guest();
    let state = await playing(a, b);
    const request = { roomId: state.id, type: 'roll', requestId: randomUUID(), revision: state.revision };
    const db = new DatabaseSync(databasePath);
    db.exec(`CREATE TRIGGER block_writes BEFORE UPDATE ON rooms BEGIN SELECT RAISE(FAIL, 'test write failure'); END;`);
    try {
      expect(await emit(a.socket, 'command', request)).toMatchObject({ ok: false, code: 'STORAGE_UNAVAILABLE' });
      expect((await fetch(`${url}/api/health`)).status).toBe(503);
      const saved = JSON.parse((db.prepare('SELECT snapshot FROM rooms WHERE id=?').get(state.id) as { snapshot: string }).snapshot);
      expect(saved.game).toEqual(state.game);
      expect(db.prepare('SELECT seq FROM processed WHERE request_id=?').get(request.requestId)).toBeUndefined();
      db.exec('DROP TRIGGER block_writes;');
      state = room(await emit(a.socket, 'command', request));
      expect(state.game).toMatchObject({ dice: 6, phase: 'move' });
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS block_writes;');
      db.close();
    }
  });

  it.each([true, false])('supports a fresh ready-gated rematch (return to lobby: %s)', async returnToLobby => {
    const a = await guest(), b = await guest();
    let state = await playing(a, b, 'classic');
    const oldMatch = state.game!.id;
    await app.close();
    const db = new DatabaseSync(databasePath);
    const saved = JSON.parse((db.prepare('SELECT snapshot FROM rooms WHERE id=?').get(state.id) as { snapshot: string }).snapshot);
    saved.game.positions[0][0] = 94;
    db.prepare('UPDATE rooms SET snapshot=? WHERE id=?').run(JSON.stringify(saved), state.id);
    db.close();
    await start();
    const backA = await guest(a.cookie), backB = await guest(b.cookie);
    state = await join(backA, state.invite);
    state = await join(backB, state.invite);
    state = room(await act(backA, state, { type: 'roll' }));
    expect(state.status).toBe('results');
    expect(state.game?.winner).toBe(0);
    expect(await act(backA, state, { type: 'start' })).toMatchObject({ ok: false, code: 'NOT_READY' });
    if (returnToLobby) {
      expect(await act(backB, state, { type: 'lobby' })).toMatchObject({ ok: false, code: 'HOST_ONLY' });
      state = room(await act(backA, state, { type: 'lobby' }));
      expect(state).toMatchObject({ game: null, status: 'lobby' });
    }
    state = room(await act(backA, state, { type: 'ready', ready: true }));
    state = room(await act(backB, state, { type: 'ready', ready: true }));
    state = room(await act(backA, state, { type: 'start' }));
    expect(state.game?.id).not.toBe(oldMatch);
    expect(state.game?.positions).toEqual([[0], [0]]);
    expect(state.status).toBe('playing');
  });

  it('keeps a connected relaxed room alive, then expires an abandoned room', async () => {
    await app.close();
    await start({ roomTtlMs: 100, graceMs: 30 });
    const a = await guest(), b = await guest();
    let state = await create(a);
    await new Promise(done => setTimeout(done, 220));
    state = await join(a, state.invite);
    expect(state.seats[0].online).toBe(true);
    a.socket.disconnect();
    await new Promise(done => setTimeout(done, 180));
    expect(await emit(b.socket, 'join', { protocol: 1, invitation: state.invite, name: 'Too late' }))
      .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    const db = new DatabaseSync(databasePath);
    expect(db.prepare('SELECT id FROM rooms WHERE id=?').get(state.id)).toBeUndefined();
    db.close();
  });

  it('bounds persisted request history and never replays an evicted stale mutation', async () => {
    const guests = [await guest(), await guest(), await guest()];
    let state = await create(guests[0]);
    state = await join(guests[1], state.invite);
    state = await join(guests[2], state.invite);
    const first = {
      roomId: state.id, type: 'ready', ready: true, requestId: randomUUID(), revision: state.revision,
    };
    state = room(await emit(guests[0].socket, 'command', first));
    for (let i = 1; i < 260; i++) {
      state = room(await act(guests[i % 3], state, { type: 'ready', ready: i % 2 === 0 }));
    }
    const db = new DatabaseSync(databasePath);
    expect((db.prepare('SELECT count(*) AS n FROM processed WHERE room_id=?').get(state.id) as { n: number }).n).toBe(256);
    expect(db.prepare('SELECT seq FROM processed WHERE request_id=?').get(first.requestId)).toBeUndefined();
    db.close();
    expect(await emit(guests[0].socket, 'command', first)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    expect((await join(guests[0], state.invite)).revision).toBe(state.revision);
  }, 15_000);

  it('rate-limits invitation guesses and keeps structured logs free of credentials and payloads', async () => {
    const entries: unknown[] = [];
    await app.close();
    await start({ logger: entry => entries.push(entry) });
    const a = await guest(), b = await guest();
    const state = await create(a, 'classic', 'Secret nickname');
    let last: RoomReply | undefined;
    for (let i = 0; i < 31; i++) {
      last = await emit(b.socket, 'join', { protocol: 1, invitation: 'ZZZZZZ', name: 'Secret nickname' });
    }
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('Secret nickname');
    expect(logged).not.toContain(state.invite);
    expect(logged).not.toContain(a.cookie);
    expect(logged).toContain('RATE_LIMIT');
  });

  it('bounds seats, preserves reconnect ownership, and resets readiness on new seats', async () => {
    const a = await guest(), b = await guest(), c = await guest(), d = await guest(), e = await guest();
    let state = await create(a);
    state = room(await act(a, state, { type: 'ready', ready: true }));
    state = await join(b, state.code.toLowerCase());
    expect(state.seats[0].ready).toBe(false);
    state = await join(c, state.id);
    state = room(await act(a, state, { type: 'bot', add: true }));
    expect(state.seats).toHaveLength(4);
    expect(await act(a, state, { type: 'bot', add: true })).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(await emit(d.socket, 'join', { protocol: 1, invitation: state.code, name: 'Fourth human' }))
      .toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(await emit(e.socket, 'join', { protocol: 1, invitation: 'ZZZZZZ', name: 'Unknown' }))
      .toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    const duplicateCreateId = randomUUID();
    const createRequest = { protocol: 1, preset: 'classic', name: 'Host', requestId: duplicateCreateId };
    const first = room(await emit(d.socket, 'create', createRequest));
    expect(room(await emit(d.socket, 'create', createRequest)).id).toBe(first.id);
    state = room(await act(a, state, { type: 'bot', add: false }));
    state = await join(d, state.invite);
    expect(state.seats.map(s => s.color).length).toBe(new Set(state.seats.map(s => s.color)).size);
    expect(state.seats.map(s => s.id)).toContain(d.you);
  });

  it('releases lobby seats explicitly and gives a new human host control in a bot-only lobby', async () => {
    const a = await guest(), b = await guest();
    let state = await create(a);
    state = room(await act(a, state, { type: 'bot', add: true }));
    state = room(await act(a, state, { type: 'leave' }));
    expect(state.seats).toHaveLength(1);
    expect(state.seats[0].bot).toBe(true);
    state = await join(b, state.invite);
    expect(state.host).toBe(b.you);
    state = room(await act(b, state, { type: 'ready', ready: true }));
    expect(room(await act(b, state, { type: 'start' })).status).toBe('playing');
  });

  it('serializes concurrent attempts for the final seat without overbooking', async () => {
    const a = await guest(), b = await guest(), c = await guest();
    let state = await create(a);
    state = room(await act(a, state, { type: 'bot', add: true }));
    state = room(await act(a, state, { type: 'bot', add: true }));
    const replies = await Promise.all([b, c].map(g => emit(g.socket, 'join', {
      protocol: 1, invitation: state.invite, name: 'Last player',
    })));
    expect(replies.filter(reply => reply.ok)).toHaveLength(1);
    expect(replies.find(reply => !reply.ok)).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect((await join(a, state.invite)).seats).toHaveLength(4);
  });

  it('finishes accepted commands before graceful shutdown and persists guest reclaim state', async () => {
    const a = await guest(), b = await guest();
    const state = await playing(a, b);
    const request = { roomId: state.id, type: 'roll', requestId: randomUUID(), revision: state.revision };
    const accepted = room(await emit(a.socket, 'command', request));
    const first = app.close();
    expect(app.close()).toBe(first);
    await first;
    await start();
    const restored = await guest(a.cookie);
    const next = await join(restored, state.invite);
    expect(next.game).toEqual(accepted.game);
    expect(next.revision).toBe(accepted.revision);
    expect(next.seats[0].id).toBe(a.you);
    expect(room(await emit(restored.socket, 'command', request)).game).toEqual(accepted.game);
  });

  it('creates a consistent live WAL backup and restores rooms, guest credentials and dedupe', async () => {
    const a = await guest(), b = await guest();
    const state = await playing(a, b);
    const request = { roomId: state.id, type: 'roll', requestId: randomUUID(), revision: state.revision };
    const accepted = room(await emit(a.socket, 'command', request));
    const backup = resolve(directory, "snapshot's.sqlite");
    const restoredPath = resolve(directory, 'restored.sqlite');
    snapshotDatabase(databasePath, backup);
    expect(() => snapshotDatabase(databasePath, backup)).toThrow('already exist');
    await app.close();
    snapshotDatabase(backup, restoredPath);
    databasePath = restoredPath;
    await start();
    const restored = await guest(a.cookie);
    expect(restored.you).toBe(a.you);
    const next = await join(restored, state.invite);
    expect(next.game).toEqual(accepted.game);
    expect(room(await emit(restored.socket, 'command', request)).game).toEqual(accepted.game);
  });

  it('migrates host after grace and only explicitly replaces absent humans after grace', async () => {
    const a = await guest(), b = await guest(), c = await guest();
    let state = await playing(a, b);
    expect(await act(a, state, { type: 'replace', seat: b.you }))
      .toMatchObject({ ok: false, code: 'PLAYER_PRESENT' });
    b.socket.disconnect();
    await waitFor(async () => !(await join(a, state.invite)).seats.find(s => s.id === b.you)?.online);
    state = await join(a, state.invite);
    expect(await act(a, state, { type: 'replace', seat: b.you }))
      .toMatchObject({ ok: false, code: 'PLAYER_PRESENT' });
    await new Promise(done => setTimeout(done, 110));
    state = await join(a, state.invite);
    state = room(await act(a, state, { type: 'replace', seat: b.you }));
    expect(state.seats[1].bot).toBe(true);
    expect(state.game?.players[1].id).toBe(state.seats[1].id);
    expect(state.seats[1].id).not.toBe(b.you);
    const replaced = await guest(b.cookie);
    expect(await emit(replaced.socket, 'join', { protocol: 1, invitation: state.invite, name: 'Back' }))
      .toMatchObject({ ok: false, code: 'MATCH_STARTED' });

    let lobby = await create(a);
    const returnedB = await guest(b.cookie);
    lobby = await join(returnedB, lobby.invite);
    lobby = await join(c, lobby.invite);
    a.socket.disconnect();
    await waitFor(async () => (await join(c, lobby.invite)).host === b.you);
    lobby = await join(c, lobby.invite);
    expect(lobby.host).toBe(b.you);
    expect(await act(c, lobby, { type: 'bot', add: true })).toMatchObject({ ok: false, code: 'HOST_ONLY' });
  });

  it('pauses bot orchestration when no humans are online and resumes one timer on reconnect', async () => {
    await app.close();
    await start({ botDelayMs: 30 });
    const a = await guest();
    let state = await create(a, 'classic');
    state = room(await act(a, state, { type: 'bot', add: true }));
    state = room(await act(a, state, { type: 'ready', ready: true }));
    state = room(await act(a, state, { type: 'start' }));
    state = room(await act(a, state, { type: 'roll' }));
    expect(state.game?.turn).toBe(1);
    a.socket.disconnect();
    await new Promise(done => setTimeout(done, 100));
    const db = new DatabaseSync(databasePath);
    const saved = JSON.parse((db.prepare('SELECT snapshot FROM rooms WHERE id=?').get(state.id) as { snapshot: string }).snapshot);
    expect(saved.game.revision).toBe(state.game?.revision);
    db.close();
    const back = await guest(a.cookie);
    await join(back, state.invite);
    await waitFor(async () => (await join(back, state.invite)).game!.revision > state.game!.revision);
    const resumed = await join(back, state.invite);
    expect(resumed.game!.revision).toBe(state.game!.revision + 1);
    expect(resumed.game?.turn).toBe(0);
  });

  it('rejects cross-origin requests and unauthenticated sockets', async () => {
    const response = await fetch(`${url}/api/session`, { headers: { Origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    const socket = io(url, { transports: ['websocket'], reconnection: false, autoConnect: false });
    sockets.push(socket);
    const error = await new Promise<Error>(done => {
      socket.once('connect_error', done);
      socket.connect();
    });
    expect(error.message).toContain('session');
    const g = await guest();
    const forbidden = io(url, {
      transports: ['websocket'], extraHeaders: { Cookie: g.cookie, Origin: 'https://evil.example' },
      reconnection: false, autoConnect: false,
    });
    sockets.push(forbidden);
    await new Promise<void>(done => {
      forbidden.once('connect_error', () => done());
      forbidden.connect();
    });
    expect(forbidden.connected).toBe(false);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  it('serves same-origin static MIME, cache/CSP headers and SPA fallback without traversal', async () => {
    const dist = resolve(directory, 'dist');
    mkdirSync(resolve(dist, 'assets'), { recursive: true });
    writeFileSync(resolve(dist, 'index.html'), '<!doctype html><h1>Board games</h1>');
    writeFileSync(resolve(dist, 'sw.js'), '// service worker');
    writeFileSync(resolve(dist, 'assets', 'app-12345678.js'), `export const game = 1;\n${'// board games\n'.repeat(200)}`);
    writeFileSync(resolve(directory, 'private.txt'), 'not public');
    await app.close();
    await start({ distPath: dist });
    const index = await fetch(`${url}/rooms/a-room`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await index.text()).toContain('Board games');
    const asset = await fetch(`${url}/assets/app-12345678.js`);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-encoding')).toBe('gzip');
    expect(await asset.text()).toContain('export const game = 1;');
    const repeated = await fetch(`${url}/assets/app-12345678.js`);
    expect(repeated.headers.get('content-encoding')).toBe('gzip');
    expect(await repeated.text()).toContain('export const game = 1;');
    const unencoded = await fetch(`${url}/assets/app-12345678.js`, { headers: { 'Accept-Encoding': 'gzip;q=0' } });
    expect(unencoded.headers.get('content-encoding')).toBeNull();
    expect((await fetch(`${url}/sw.js`)).headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
    const traversal = await fetch(`${url}/%2e%2e%5cprivate.txt`);
    expect(traversal.status).not.toBe(200);
    expect(await traversal.text()).not.toContain('not public');
    expect((await fetch(`${url}/api/session`, { method: 'POST' })).status).toBe(405);
  });
});
