import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createServer } from '../server/app.js';
import type { Room, RoomReply } from '../shared/protocol.js';

const directory = resolve(`.room-load-${randomUUID()}`);
mkdirSync(directory);
const handler: number[] = [];
const roundtrip: number[] = [];
const rssBaseline = process.memoryUsage().rss;
let rssPeak = rssBaseline;
const app = createServer({
  databasePath: resolve(directory, 'games.sqlite'),
  onCommandHandled: duration => handler.push(duration),
});
type Guest = { socket: Socket; cookie: string; you: string };
const guests: Guest[] = [];
const states: Room[] = [];
let sampler: ReturnType<typeof setInterval> | undefined;
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function drain(check: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while (!check() && performance.now() < deadline) await wait(25);
  assert(check(), message);
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
}
function emit(socket: Socket, event: string, input: unknown): Promise<Room> {
  const started = performance.now();
  return new Promise((done, fail) => {
    socket.timeout(10_000).emit(event, input, (error: Error | null, reply: RoomReply) => {
      if (error) { fail(error); return; }
      if (!reply.ok) { fail(new Error(`${event}: ${reply.code}`)); return; }
      if (event === 'command') roundtrip.push(performance.now() - started);
      done(reply.value.room);
    });
  });
}
async function connect(url: string, guest?: Guest): Promise<Guest> {
  let cookie = guest?.cookie;
  let you = guest?.you;
  if (!cookie) {
    const response = await fetch(`${url}/api/session`);
    assert(response.ok, `Session endpoint returned ${response.status}`);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    you = ((await response.json()) as { you: string }).you;
  }
  const socket = io(url, {
    transports: ['websocket'], reconnection: false, autoConnect: false,
    extraHeaders: { Cookie: cookie, Origin: url },
    timeout: 10_000,
  });
  const result = { socket, cookie, you: you! };
  guests.push(result);
  await new Promise<void>((done, fail) => {
    socket.once('connect', done);
    socket.once('connect_error', fail);
    socket.connect();
  });
  return result;
}
function command(guest: Guest, state: Room, action: Record<string, unknown>) {
  return emit(guest.socket, 'command', {
    roomId: state.id, requestId: randomUUID(), revision: state.revision, ...action,
  });
}

try {
  // Fixed high port avoids Fetch's blocked-port list; fail rather than touch an existing listener.
  const url = `http://127.0.0.1:${await app.listen(32847)}`;
  sampler = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 50);
  const started = performance.now();
  const tables: Guest[][] = [];
  for (let roomIndex = 0; roomIndex < 25; roomIndex++) {
    const table: Guest[] = [];
    let state: Room | undefined;
    for (let seat = 0; seat < 4; seat++) {
      const guest = await connect(url);
      table.push(guest);
      state = await emit(guest.socket, seat === 0 ? 'create' : 'join', seat === 0
        ? { protocol: 1, requestId: randomUUID(), preset: 'classic', name: `Player ${seat + 1}` }
        : { protocol: 1, invitation: state!.invite, name: `Player ${seat + 1}` });
    }
    for (const guest of table) state = await command(guest, state!, { type: 'ready', ready: true });
    state = await command(table[0], state!, { type: 'start' });
    tables.push(table);
    states.push(state);
  }
  assert(app.diagnostics().connections === 100, 'Expected 100 connected clients.');
  // Four rounds, paced at 100ms per turn per room: accelerated legal play, not a human dwell-time model.
  await Promise.all(states.map(async (initial, index) => {
    let state = initial;
    for (let turn = 0; turn < 16 && state.status === 'playing'; turn++) {
      const current = tables[index].find(guest => guest.you === state.game!.players[state.game!.turn].id)!;
      state = await command(current, state, { type: 'roll' });
      await wait(100);
    }
    states[index] = state;
  }));
  // One seat in every room reconnects concurrently with the same opaque credential.
  const burst = tables.map(table => table[1]);
  for (const guest of burst) guest.socket.disconnect();
  await wait(80);
  await Promise.all(burst.map(async (old, index) => {
    const back = await connect(url, old);
    const state = await emit(back.socket, 'join', {
      protocol: 1, invitation: states[index].invite, name: 'Reconnected',
    });
    assert(state.seats.some(seat => seat.id === old.you), 'Reconnect lost seat ownership.');
    assert(state.game!.revision === states[index].game!.revision, 'Reconnect changed game state.');
    tables[index][1] = back;
  }));
  const active = app.diagnostics();
  assert(active.connections === 100 && active.presenceSockets === 100, 'Reconnect leaked a connection or presence.');
  assert(active.botTimers === 0 && active.lifecycleTimers === 1, 'Unexpected active timer count.');
  assert(active.presenceGroups === 25 && active.rateBuckets <= 250, 'Resource count exceeded fixed workload bounds.');
  for (const guest of guests) guest.socket.disconnect();
  await drain(() => app.diagnostics().connections === 0 && app.diagnostics().presenceSockets === 0,
    'Disconnect leaked sockets after a bounded five-second drain.');
  const disconnected = app.diagnostics();
  assert(disconnected.connections === 0 && disconnected.presenceSockets === 0, 'Disconnect leaked sockets.');
  await app.close();
  const closed = app.diagnostics();
  assert(closed.botTimers === 0 && closed.lifecycleTimers === 0, 'Shutdown leaked application timers.');
  assert(closed.rooms === 0 && closed.presenceGroups === 0 && closed.rateBuckets === 0, 'Shutdown retained application maps.');
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  console.log(JSON.stringify({
    profile: 'local Windows Node; NOT Docker 1 CPU/512MiB capacity certification',
    workload: { rooms: 25, seatsPerRoom: 4, clients: 100, reconnectBurst: 25, turnsPerRoom: 16, pacingMs: 100 },
    elapsedMs: Math.round(performance.now() - started),
    commandSamples: handler.length,
    commandHandlerP95Ms: percentile(handler, 0.95),
    commandHandlerDefinition: 'Synchronous validated command execution including SQLite commit and broadcast enqueue; excludes network and ACK serialization',
    commandRoundtripP95Ms: percentile(roundtrip, 0.95),
    commandRoundtripDefinition: 'Client emit to received ACK, including event-loop queue, local transport and synchronous handler',
    rssMiB: {
      baseline: Number((rssBaseline / 2 ** 20).toFixed(1)),
      sampledPeak: Number((rssPeak / 2 ** 20).toFixed(1)),
      afterClose: Number((process.memoryUsage().rss / 2 ** 20).toFixed(1)),
    },
    resourcesActive: active,
    resourcesAfterDisconnect: disconnected,
    resourcesAfterClose: closed,
    note: 'RSS includes server and all 100 in-process clients; no forced GC. Only app-owned timer counters are asserted.',
  }, null, 2));
} finally {
  if (sampler) clearInterval(sampler);
  for (const guest of guests) guest.socket.disconnect();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
