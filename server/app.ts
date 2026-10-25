import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { dirname, extname, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { botToken, colors, createGame, transition } from '../shared/game.js';
import {
  commandSchema, createSchema, joinSchema, roomSchema,
  type Command, type Room, type RoomReply,
} from '../shared/protocol.js';

export interface ServerOptions {
  databasePath: string;
  distPath?: string;
  /** Exact public origin, e.g. https://play.example.com. No trailing slash. */
  origin?: string;
  graceMs?: number;
  roomTtlMs?: number;
  sessionTtlMs?: number;
  botDelayMs?: number;
  maxRooms?: number;
  maxConnections?: number;
  maxSessions?: number;
  /** Structured messages never include names, invite tokens, cookies, or request payloads. */
  logger?: (entry: { event: string; code?: string; roomId?: string }) => void;
  /** Optional local instrumentation; excludes transport/ACK serialization time. */
  onCommandHandled?: (durationMs: number) => void;
}

class Rejection extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function reject(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new Rejection(code, message);
}
const commandInput = z.object({
  roomId: z.string().min(1).max(64),
}).passthrough().transform(({ roomId, ...command }) => ({ roomId, command: commandSchema.parse(command) }));
const cookieName = 'board_guest';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const compress = promisify(gzip);
function acceptsGzip(header: string | undefined) {
  return header?.split(',').some(value => {
    const [encoding, ...parameters] = value.toLowerCase().trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return encoding.trim() === 'gzip' && q > 0 && q <= 1;
  }) ?? false;
}
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
type Member = { sockets: Set<string>; since: number };
type Processed = { roomId: string; reply: RoomReply; fingerprint: string };

/** Single-process authority: all validation/transition/SQLite commits are synchronous. */
export function createServer(options: ServerOptions) {
  const graceMs = options.graceMs ?? 15_000;
  const roomTtlMs = options.roomTtlMs ?? 24 * 60 * 60_000;
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60_000;
  const botDelayMs = options.botDelayMs ?? 850;
  const maxRooms = options.maxRooms ?? 250;
  const maxConnections = options.maxConnections ?? 500;
  const maxSessions = options.maxSessions ?? 20_000;
  for (const value of [graceMs, roomTtlMs, sessionTtlMs, botDelayMs, maxRooms, maxConnections, maxSessions]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid server limits.');
  }
  if (sessionTtlMs < roomTtlMs) throw new Error('Session lifetime must cover room lifetime.');
  if (options.origin !== undefined) {
    const origin = new URL(options.origin);
    if (origin.origin !== options.origin || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid public origin.');
  }
  const log = options.logger ?? (() => {});
  if (options.databasePath !== ':memory:') mkdirSync(dirname(resolve(options.databasePath)), { recursive: true });
  const db = new DatabaseSync(options.databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const schemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (schemaVersion > 1) { db.close(); throw new Error('Database schema is newer than this server.'); }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, invite TEXT NOT NULL UNIQUE,
      snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, guest TEXT NOT NULL, request_id TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, reply TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(guest, request_id)
    );
    CREATE INDEX IF NOT EXISTS processed_room ON processed(room_id, seq);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS room_expiry ON rooms(expires_at);
    PRAGMA user_version=1;
  `);
  const rooms = new Map<string, Room>();
  const members = new Map<string, Map<string, Member>>();
  const absent = new Map<string, number>();
  const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const limits = new Map<string, { count: number; until: number }>();
  const assetCache = new Map<string, { signature: string; bytes: number; encoded: Promise<{ raw: Buffer; gzip?: Buffer }> }>();
  let assetCacheBytes = 0;
  const assetCacheLimit = 16 * 1024 * 1024;
  let closing = false;
  let shutdown: Promise<void> | undefined;
  let degraded = false;
  const startup = Date.now();
  db.prepare('DELETE FROM rooms WHERE expires_at < ?').run(startup);
  try {
    for (const row of db.prepare('SELECT snapshot FROM rooms').all() as { snapshot: string }[]) {
      const room = roomSchema.parse(JSON.parse(row.snapshot));
      for (const seat of room.seats) { seat.online = false; seat.absentSince = seat.bot ? null : startup; }
      rooms.set(room.id, room);
      for (const seat of room.seats) if (!seat.bot) absent.set(`${room.id}:${seat.id}`, startup);
    }
  } catch {
    db.close();
    throw new Error('Incompatible or corrupt room snapshot. Restore a compatible database; no rooms were reset.');
  }
  function allow(key: string, count: number, windowMs = 60_000) {
    const now = Date.now();
    const bucket = limits.get(key);
    if (!bucket || bucket.until <= now) {
      if (limits.size >= 20_000) {
        for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
        if (limits.size >= 20_000) throw new Rejection('RATE_LIMIT', 'Server is busy. Try again shortly.');
      }
      limits.set(key, { count: 1, until: now + windowMs });
    } else {
      if (bucket.count >= count) throw new Rejection('RATE_LIMIT', 'Too many requests. Try again shortly.');
      bucket.count++;
    }
  }
  function expectedOrigin(req: IncomingMessage) {
    return options.origin ?? `http://${req.headers.host}`;
  }
  function validOrigin(req: IncomingMessage, required = false) {
    const origin = req.headers.origin;
    return (!origin && !required) || origin === expectedOrigin(req);
  }
  function identity(req: IncomingMessage): { you: string; expires: number; token: string } | undefined {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = db.prepare('SELECT public_id, expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as
      { public_id: string; expires_at: number } | undefined;
    return row && row.expires_at > Date.now() ? { you: row.public_id, expires: row.expires_at, token } : undefined;
  }
  function projected(room: Room): Room {
    return {
      ...room,
      seats: room.seats.map(seat => ({
        ...seat,
        online: !seat.bot && !!members.get(room.id)?.get(seat.id)?.sockets.size,
        absentSince: seat.bot || members.get(room.id)?.get(seat.id)?.sockets.size ? null
          : absent.get(`${room.id}:${seat.id}`) ?? seat.absentSince ?? Date.now(),
      })),
    };
  }
  function response(room: Room, you: string): RoomReply {
    return { ok: true, value: { room: projected(room), you } };
  }
  function broadcast(room: Room) { io.to(room.id).emit('room', projected(room)); }
  function failure(error: unknown, room?: Room): RoomReply {
    if (error instanceof Rejection) return {
      ok: false, code: error.code, error: error.message, ...(room ? { room: projected(room) } : {}),
    };
    if (error instanceof z.ZodError) return { ok: false, code: 'INVALID_INPUT', error: 'Invalid or incompatible request.' };
    if (error && typeof error === 'object' && 'code' in error && String(error.code).startsWith('ERR_SQLITE')) degraded = true;
    log({ event: 'request_failed', code: degraded ? 'STORAGE_UNAVAILABLE' : 'INTERNAL' });
    return { ok: false, code: degraded ? 'STORAGE_UNAVAILABLE' : 'INTERNAL', error: degraded
      ? 'Storage is unavailable. No change was accepted; retry the same request.'
      : 'The request could not be completed.' };
  }
  function remembered(you: string, requestId: string, fingerprint: string): Processed | undefined {
    const row = db.prepare('SELECT room_id, reply, fingerprint FROM processed WHERE guest=? AND request_id=?')
      .get(you, requestId) as { room_id: string; reply: string; fingerprint: string } | undefined;
    if (!row) return;
    reject(row.fingerprint === fingerprint, 'REQUEST_CONFLICT', 'This request ID has already been used for a different command.');
    return { roomId: row.room_id, reply: JSON.parse(row.reply) as RoomReply, fingerprint: row.fingerprint };
  }
  function commit(room: Room, by?: { you: string; requestId: string; fingerprint: string; connecting?: boolean }): RoomReply | undefined {
    roomSchema.parse(room);
    const reply = by ? response(room, by.you) : undefined;
    if (by?.connecting && reply?.ok) {
      const seat = reply.value.room.seats.find(s => s.id === by.you);
      if (seat) { seat.online = true; seat.absentSince = null; }
    }
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`INSERT INTO rooms(id,code,invite,snapshot,expires_at) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot, expires_at=excluded.expires_at`)
        .run(room.id, room.code, room.invite, JSON.stringify(room), room.expiresAt);
      if (by) {
        db.prepare('INSERT INTO processed(guest,request_id,room_id,fingerprint,reply,created_at) VALUES(?,?,?,?,?,?)')
          .run(by.you, by.requestId, room.id, by.fingerprint, JSON.stringify(reply), Date.now());
        // Fixed active retry window: retain the most recent 256 accepted requests per room.
        db.prepare(`DELETE FROM processed WHERE room_id=? AND seq NOT IN
          (SELECT seq FROM processed WHERE room_id=? ORDER BY seq DESC LIMIT 256)`).run(room.id, room.id);
      }
      db.exec('COMMIT');
      degraded = false;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction may not have begun. */ }
      degraded = true;
      log({ event: 'storage_failed', code: 'SQLITE_WRITE' });
      throw error;
    }
    rooms.set(room.id, room);
    return reply;
  }
  function findRoom(invitation: string): Room {
    const room = [...rooms.values()].find(r => r.id === invitation || r.code === invitation.toUpperCase() || r.invite === invitation);
    reject(room && (room.expiresAt > Date.now() || hasHuman(room)), 'ROOM_NOT_FOUND', 'This room does not exist or has expired.');
    return room;
  }
  function hasHuman(room: Room) {
    return room.seats.some(seat => !seat.bot && !!members.get(room.id)?.get(seat.id)?.sockets.size);
  }
  function attach(socket: Socket, room: Room, you: string) {
    if (!room.seats.some(seat => seat.id === you && !seat.bot)) return;
    let group = members.get(room.id);
    if (!group) { group = new Map(); members.set(room.id, group); }
    let member = group.get(you);
    if (!member) { member = { sockets: new Set(), since: Date.now() }; group.set(you, member); }
    member.sockets.add(socket.id);
    absent.delete(`${room.id}:${you}`);
    socket.join(room.id);
    broadcast(room);
    scheduleBot(room);
  }
  function detach(socket: Socket, roomId?: string) {
    for (const [id, group] of members) {
      if (roomId && id !== roomId) continue;
      const member = group.get(socket.data.you as string);
      if (!member?.sockets.delete(socket.id)) continue;
      if (!member.sockets.size) {
        group.delete(socket.data.you as string);
        absent.set(`${id}:${socket.data.you as string}`, Date.now());
      }
      socket.leave(id);
      const room = rooms.get(id);
      if (room) broadcast(room);
    }
  }
  function resetReady(room: Room) {
    room.seats = room.seats.map(seat => ({ ...seat, ready: seat.bot }));
  }
  function uniqueName(room: Room, requested: string, ignoreId?: string) {
    if (!room.seats.some(seat => seat.id !== ignoreId && seat.name.toLocaleLowerCase() === requested.toLocaleLowerCase())) return requested;
    for (let suffix = 2; suffix <= 5; suffix++) {
      const ending = ` ${suffix}`;
      const candidate = `${requested.slice(0, 20 - ending.length).trimEnd()}${ending}`;
      if (!room.seats.some(seat => seat.id !== ignoreId && seat.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) return candidate;
    }
    throw new Rejection('INVALID_NAME', 'Choose a different display name.');
  }
  function mutate(current: Room, you: string, command: Command): Room {
    const room = structuredClone(current);
    const seat = room.seats.find(s => s.id === you && !s.bot);
    reject(seat, 'NOT_SEATED', 'Your seat is no longer in this room; it may have been replaced.');
    reject(command.revision === room.revision, 'STALE_REVISION', 'The room changed. Review the latest state and try again.');
    const host = () => reject(room.host === you, 'HOST_ONLY', 'Only the host can do that.');
    const lobby = () => reject(room.status === 'lobby', 'MATCH_STARTED', 'This can only be changed in the lobby.');
    switch (command.type) {
      case 'ready':
        reject(room.status !== 'playing', 'MATCH_STARTED', 'The match is already in progress.');
        seat.ready = command.ready;
        break;
      case 'profile':
        seat.name = uniqueName(room, command.name, you);
        seat.avatar = command.avatar;
        seat.piece = command.piece;
        if (room.game) {
          const idx = room.game.players.findIndex(p => p.id === you);
          if (idx >= 0) {
            room.game.players[idx] = { ...room.game.players[idx], name: seat.name, avatar: seat.avatar, piece: seat.piece };
          }
        }
        break;
      case 'shuffle':
        host(); lobby();
        room.boardSeed = (room.boardSeed + 1) % 1000000;
        resetReady(room);
        break;
      case 'start':
        host();
        reject(room.status !== 'playing', 'MATCH_STARTED', 'The match is already in progress.');
        reject(room.seats.length >= 2, 'NEED_PLAYERS', 'At least two players are needed.');
        reject(room.seats.every(s => s.bot || (s.ready && projected(room).seats.find(p => p.id === s.id)?.online)),
          'NOT_READY', 'All human players must be online and ready.');
        room.game = createGame(room.preset, room.seats.map(({ ready: _r, online: _o, absentSince: _a, ...player }) => player), randomUUID(), room.boardSeed);
        room.status = 'playing';
        resetReady(room);
        break;
      case 'bot':
        host(); lobby();
        if (command.add) {
          reject(room.seats.length < 4, 'ROOM_FULL', 'All four seats are occupied.');
          room.seats.push({
            id: `bot-${randomUUID()}`, name: uniqueName(room, ['Mochi', 'Pip', 'Clover', 'Sunny'][room.seats.length]),
            avatar: 'bear', piece: (['queen', 'knight', 'rook', 'bishop'] as const)[room.seats.length % 4],
            color: colors.find(c => !room.seats.some(s => s.color === c))!,
            bot: true, ready: true, online: false, absentSince: null,
          });
        } else {
          const index = room.seats.findLastIndex(s => s.bot);
          reject(index >= 0, 'NO_BOT', 'There is no bot to remove.');
          room.seats.splice(index, 1);
        }
        resetReady(room);
        break;
      case 'replace': {
        host();
        const index = room.seats.findIndex(s => s.id === command.seat && !s.bot);
        reject(index >= 0, 'NO_PLAYER', 'That human seat does not exist.');
        const target = projected(current).seats[index];
        reject(!target.online && target.absentSince !== null && Date.now() - target.absentSince >= graceMs,
          'PLAYER_PRESENT', 'A player can only be replaced after the disconnect grace period.');
        const replacement = { ...room.seats[index], id: `bot-${randomUUID()}`, name: uniqueName(room, 'Mochi (bot)'), bot: true, ready: true, online: false, absentSince: null };
        room.seats[index] = replacement;
        if (room.game) {
          const { ready: _r, online: _o, absentSince: _a, ...player } = replacement;
          room.game.players[index] = player;
          room.game.events = [{ type: 'pass', player: index, text: 'The host replaced an absent player with a bot.' }];
        }
        if (room.status !== 'playing') resetReady(room);
        break;
      }
      case 'lobby':
        host();
        reject(room.status === 'results', 'MATCH_ACTIVE', 'Finish the match before returning to the lobby.');
        room.status = 'lobby'; room.game = null; resetReady(room);
        break;
      case 'leave':
        if (room.status === 'playing') {
          // An explicit leave releases control, not the board position. The host may replace it after grace.
          seat.ready = false;
        } else {
          room.seats = room.seats.filter(s => s.id !== you);
          resetReady(room);
          if (room.host === you) room.host = room.seats.find(s => !s.bot)?.id ?? '';
        }
        break;
      case 'roll':
      case 'move':
        reject(room.status === 'playing' && room.game, 'NO_MATCH', 'There is no active match.');
        reject(room.game.players[room.game.turn].id === you, 'NOT_YOUR_TURN', 'It is not your turn.');
        try {
          room.game = transition(room.game, command.type === 'roll'
            ? { type: 'roll', value: randomInt(1, 7) } : { type: 'move', token: command.token });
        } catch (error) {
          throw new Rejection('ILLEGAL_ACTION', error instanceof Error ? error.message : 'Illegal action.');
        }
        if (room.game.phase === 'finished') { room.status = 'results'; resetReady(room); }
        break;
    }
    room.revision++;
    room.expiresAt = Date.now() + roomTtlMs;
    return room;
  }
  function scheduleBot(room: Room) {
    if (closing || botTimers.has(room.id) || room.status !== 'playing' || !room.game || !hasHuman(room) ||
        !room.game.players[room.game.turn].bot) return;
    botTimers.set(room.id, setTimeout(() => {
      botTimers.delete(room.id);
      const current = rooms.get(room.id);
      if (!current || !hasHuman(current) || current.status !== 'playing' || !current.game ||
          !current.game.players[current.game.turn].bot || closing) return;
      try {
        const next = structuredClone(current);
        next.game = transition(current.game, current.game.phase === 'move'
          ? { type: 'move', token: botToken(current.game) }
          : { type: 'roll', value: randomInt(1, 7) });
        if (next.game.phase === 'finished') { next.status = 'results'; resetReady(next); }
        next.revision++; next.expiresAt = Date.now() + roomTtlMs;
        commit(next); broadcast(next); scheduleBot(next);
      } catch {
        // Do not spin/re-roll on a failed write. Lifecycle sweep retries from committed state.
        log({ event: 'bot_failed', code: 'BOT_TRANSITION', roomId: room.id });
      }
    }, botDelayMs));
  }
  const http = createHttpServer((req, res) => { void handleHttp(req, res); });
  const io = new Server(http, {
    maxHttpBufferSize: 4096,
    serveClient: false,
    allowRequest: (req, callback) => {
      try {
        allow(`connect:${req.socket.remoteAddress ?? 'unknown'}`, 240);
        reject(validOrigin(req), 'ORIGIN', 'Origin not allowed.');
        reject(io.engine.clientsCount < maxConnections, 'CAPACITY', 'Server connection limit reached.');
        callback(null, true);
      } catch { callback('Connection rejected.', false); }
    },
  });
  io.use((socket, next) => {
    try {
      reject(!closing, 'SHUTTING_DOWN', 'Server is restarting.');
      const session = identity(socket.request);
      reject(session, 'SESSION_REQUIRED', 'Initialize your guest session before connecting.');
      socket.data.you = session.you;
      socket.data.expires = session.expires;
      next();
    } catch { next(new Error('A valid same-origin guest session is required.')); }
  });
  io.on('connection', socket => {
    const you = socket.data.you as string;
    const handler = (event: string, execute: (input: unknown) => RoomReply) => {
      socket.on(event, (input: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        let room: Room | undefined;
        try {
          reject(!closing, 'SHUTTING_DOWN', 'Server is restarting. Retry shortly.');
          reject((socket.data.expires as number) > Date.now(), 'SESSION_EXPIRED', 'Refresh to renew your guest session.');
          allow(`action:${you}`, 120);
          if (event === 'command' && input && typeof input === 'object' && 'roomId' in input) {
            room = rooms.get(String(input.roomId));
          }
          const started = performance.now();
          const result = execute(input);
          if (event === 'command' && options.onCommandHandled) {
            const durationMs = performance.now() - started;
            try { options.onCommandHandled(durationMs); } catch { /* Metrics cannot invalidate committed commands. */ }
          }
          (ack as (reply: RoomReply) => void)(result);
        } catch (error) {
          log({ event: 'request_rejected', code: error instanceof Rejection ? error.code : error instanceof z.ZodError ? 'INVALID_INPUT' : 'INTERNAL' });
          (ack as (reply: RoomReply) => void)(failure(error, room));
        }
      });
    };
    handler('create', input => {
      allow(`lookup:${you}`, 30);
      const data = createSchema.parse(input);
      const fingerprint = hash(JSON.stringify({ event: 'create', ...data }));
      const previous = remembered(you, data.requestId, fingerprint);
      if (previous) {
        const room = rooms.get(previous.roomId);
        if (room) attach(socket, room, you);
        return previous.reply;
      }
      reject(rooms.size < maxRooms, 'CAPACITY', 'The server room limit has been reached.');
      reject([...rooms.values()].filter(r => r.seats.some(s => s.id === you)).length < 10, 'CAPACITY', 'Leave an old room before creating another.');
      let code: string;
      do { code = Array.from({ length: 6 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join(''); }
      while ([...rooms.values()].some(r => r.code === code));
      const now = Date.now();
      const room: Room = {
        version: 1, id: randomUUID(), code, invite: randomBytes(24).toString('base64url'),
        preset: data.preset, boardSeed: data.boardSeed, revision: 0, host: you, status: 'lobby', game: null,
        expiresAt: now + roomTtlMs,
        seats: [{ id: you, name: data.name, avatar: data.avatar, piece: data.piece, color: 'red', bot: false, ready: false, online: false, absentSince: now }],
      };
      const reply = commit(room, { you, requestId: data.requestId, fingerprint, connecting: true })!;
      attach(socket, room, you);
      log({ event: 'room_created', roomId: room.id });
      return reply;
    });
    handler('join', input => {
      allow(`lookup:${you}`, 30);
      const data = joinSchema.parse(input);
      const fingerprint = hash(JSON.stringify({ event: 'join', ...data }));
      if (data.requestId) {
        const previous = remembered(you, data.requestId, fingerprint);
        if (previous) {
          const existing = rooms.get(previous.roomId);
          if (existing) attach(socket, existing, you);
          return previous.reply;
        }
      }
      const current = findRoom(data.invitation);
      const existing = current.seats.find(s => s.id === you);
      if (existing) { attach(socket, current, you); return response(current, you); }
      reject(current.status === 'lobby', 'MATCH_STARTED', 'This match has started, or your seat has been replaced.');
      reject(current.seats.length < 4, 'ROOM_FULL', 'All four seats are occupied.');
      const room = structuredClone(current);
      room.seats.push({
        id: you, name: uniqueName(room, data.name), avatar: data.avatar, piece: data.piece,
        color: colors.find(c => !room.seats.some(s => s.color === c))!,
        bot: false, ready: false, online: false, absentSince: Date.now(),
      });
      if (!room.seats.some(seat => seat.id === room.host && !seat.bot)) room.host = you;
      resetReady(room); room.revision++; room.expiresAt = Date.now() + roomTtlMs;
      const reply = commit(room, data.requestId ? { you, requestId: data.requestId, fingerprint, connecting: true } : undefined);
      attach(socket, room, you);
      return reply ?? response(room, you);
    });
    handler('command', input => {
      const { roomId, command } = commandInput.parse(input);
      const fingerprint = hash(JSON.stringify({ roomId, ...command }));
      const previous = remembered(you, command.requestId, fingerprint);
      if (previous) return previous.reply;
      const current = rooms.get(roomId);
      reject(current, 'ROOM_NOT_FOUND', 'This room does not exist or has expired.');
      reject(!!members.get(roomId)?.get(you)?.sockets.has(socket.id), 'NOT_JOINED', 'Join this room before sending commands.');
      const next = mutate(current, you, command);
      const reply = commit(next, { you, requestId: command.requestId, fingerprint })!;
      for (const seat of current.seats) if (!next.seats.some(s => s.id === seat.id)) absent.delete(`${roomId}:${seat.id}`);
      if (command.type === 'leave') {
        // An identity may have multiple tabs; explicit leave disconnects all its room subscriptions.
        for (const id of [...members.get(roomId)?.get(you)?.sockets ?? []]) {
          const tab = io.sockets.sockets.get(id);
          if (tab) detach(tab, roomId);
        }
      }
      broadcast(next); scheduleBot(next);
      return reply;
    });
    socket.on('disconnect', () => detach(socket));
  });
  function headers(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const websocketOrigin = expectedOrigin(req).replace(/^http/, 'ws');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${websocketOrigin}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  }
  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    headers(req, res);
    try {
      reject(!closing, 'SHUTTING_DOWN', 'Server is restarting.');
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed.' }); return; }
        if (path === '/api/health') { json(res, degraded ? 503 : 200, { ok: !degraded }); return; }
        if (path === '/api/session') {
          reject(validOrigin(req) && req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN', 'Origin not allowed.');
          allow(`session:${req.socket.remoteAddress ?? 'unknown'}`, 120);
          const session = identity(req);
          const expires = Date.now() + sessionTtlMs;
          let token = session?.token;
          let you = session?.you;
          if (!token || !you) {
            const count = db.prepare('SELECT count(*) AS n FROM sessions WHERE expires_at>?').get(Date.now()) as { n: number };
            reject(count.n < maxSessions, 'CAPACITY', 'The server guest limit has been reached.');
            token = randomBytes(32).toString('base64url');
            you = randomUUID();
          }
          try {
            if (session) db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(expires, hash(token));
            else db.prepare('INSERT INTO sessions(token_hash,public_id,expires_at) VALUES(?,?,?)').run(hash(token), you, expires);
          } catch (error) { degraded = true; throw error; }
          const secure = expectedOrigin(req).startsWith('https:') ? '; Secure' : '';
          res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`);
          json(res, 200, { you });
          return;
        }
        json(res, 404, { error: 'Not found.' }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'Method not allowed.' }); return; }
      if (!options.distPath) { json(res, 404, { error: 'Frontend has not been built.' }); return; }
      const root = resolve(options.distPath);
      let decoded: string;
      try { decoded = decodeURIComponent(path); }
      catch { throw new Rejection('INVALID_PATH', 'Invalid path encoding.'); }
      reject(!decoded.includes('\0') && !decoded.includes('\\') && !decoded.split('/').includes('..'), 'INVALID_PATH', 'Invalid path.');
      let file = resolve(root, `.${decoded}`);
      reject(file === root || file.startsWith(root + sep), 'INVALID_PATH', 'Invalid path.');
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error('Not a file');
      } catch {
        if (extname(decoded) || decoded.startsWith('/assets/')) { json(res, 404, { error: 'Not found.' }); return; }
        file = resolve(root, 'index.html');
      }
      const actual = await realpath(file);
      const actualRoot = await realpath(root);
      reject(actual.startsWith(actualRoot + sep), 'INVALID_PATH', 'Invalid path.');
      const info = await stat(actual);
      const contentType = mime[extname(file)] ?? 'application/octet-stream';
      const compressible = /text\/|javascript|json|svg|manifest/.test(contentType);
      const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      let cached = assetCache.get(actual);
      if (cached && cached.signature !== signature) {
        assetCacheBytes -= cached.bytes;
        assetCache.delete(actual);
        cached = undefined;
      }
      if (!cached) {
        const encoded = (async () => {
          const raw = await readFile(actual);
          const gzip = compressible && raw.length > 1024 ? await compress(raw) : undefined;
          return { raw, ...(gzip && gzip.length < raw.length ? { gzip } : {}) };
        })();
        // Reserve worst-case encoded size and bound both cache memory and entry count.
        const bytes = info.size * 2;
        cached = { signature, bytes, encoded };
        if (bytes <= assetCacheLimit) {
          while (assetCache.size && (assetCacheBytes + bytes > assetCacheLimit || assetCache.size >= 256)) {
            const oldest = assetCache.keys().next().value!;
            assetCacheBytes -= assetCache.get(oldest)!.bytes;
            assetCache.delete(oldest);
          }
          assetCache.set(actual, cached);
          assetCacheBytes += bytes;
        }
        void encoded.catch(() => {
          if (assetCache.get(actual)?.encoded === encoded) {
            assetCacheBytes -= assetCache.get(actual)!.bytes;
            assetCache.delete(actual);
          }
        });
      }
      const asset = await cached.encoded;
      let contents = asset.raw;
      if (compressible) {
        res.setHeader('Vary', 'Accept-Encoding');
        if (asset.gzip && acceptsGzip(req.headers['accept-encoding'])) {
          contents = asset.gzip;
          res.setHeader('Content-Encoding', 'gzip');
        }
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': decoded === '/sw.js' ? 'no-store' : /[.-][a-zA-Z0-9_-]{8,}\.(?:js|css|woff2|png|svg|webp)$/.test(file) && decoded.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const result = failure(error);
      json(res, error instanceof Rejection ? (error.code === 'RATE_LIMIT' ? 429 : 403) : 503, result);
    }
  }
  const lifecycle = setInterval(() => {
    if (closing) return;
    const now = Date.now();
    try {
      for (const [key, bucket] of limits) if (bucket.until < now) limits.delete(key);
      for (const current of rooms.values()) {
        const room = projected(current);
        const host = room.seats.find(s => s.id === room.host);
        if (host && !host.online && host.absentSince !== null && now - host.absentSince >= graceMs) {
          const connected = room.seats.filter(s => !s.bot && s.online)
            .sort((a, b) => members.get(room.id)!.get(a.id)!.since - members.get(room.id)!.get(b.id)!.since);
          if (connected.length) {
            const next = structuredClone(current);
            next.host = connected[0].id; next.revision++; next.expiresAt = now + roomTtlMs;
            commit(next); broadcast(next);
            log({ event: 'host_migrated', roomId: next.id });
          }
        }
        if (!hasHuman(current) && current.expiresAt < now) {
          db.prepare('DELETE FROM rooms WHERE id=?').run(current.id);
          rooms.delete(current.id); members.delete(current.id);
          for (const key of absent.keys()) if (key.startsWith(`${current.id}:`)) absent.delete(key);
          const timer = botTimers.get(current.id);
          if (timer) clearTimeout(timer);
          botTimers.delete(current.id);
          log({ event: 'room_expired', roomId: current.id });
        } else {
          // Refresh idle expiry in storage periodically, not on every presence heartbeat.
          if (hasHuman(current) && current.expiresAt - now < roomTtlMs / 2) {
            const next = { ...rooms.get(current.id)!, expiresAt: now + roomTtlMs };
            commit(next);
          }
          scheduleBot(rooms.get(current.id)!);
        }
      }
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    } catch {
      degraded = true;
      log({ event: 'maintenance_failed', code: 'STORAGE_UNAVAILABLE' });
    }
  }, Math.min(1000, Math.max(10, Math.floor(graceMs / 2))));
  lifecycle.unref();
  log({ event: 'server_ready' });
  return {
    http, io,
    diagnostics() {
      return {
        rooms: rooms.size,
        connections: io.engine.clientsCount,
        presenceGroups: members.size,
        presenceSockets: [...members.values()].reduce((n, group) =>
          n + [...group.values()].reduce((count, member) => count + member.sockets.size, 0), 0),
        botTimers: botTimers.size,
        lifecycleTimers: closing ? 0 : 1,
        rateBuckets: limits.size,
        assetCacheEntries: assetCache.size,
        assetCacheBytes,
      };
    },
    listen(port = 0, host = '127.0.0.1'): Promise<number> {
      return new Promise((done, fail) => {
        http.once('error', fail);
        http.listen(port, host, () => {
          http.off('error', fail);
          const address = http.address();
          if (!address || typeof address === 'string') { fail(new Error('No TCP listener.')); return; }
          done(address.port);
        });
      });
    },
    close(): Promise<void> {
      if (shutdown) return shutdown;
      closing = true;
      clearInterval(lifecycle);
      for (const timer of botTimers.values()) clearTimeout(timer);
      botTimers.clear();
      assetCache.clear();
      assetCacheBytes = 0;
      io.emit('restarting');
      shutdown = (async () => {
        await new Promise<void>(done => io.close(() => done()));
        if (http.listening) await new Promise<void>((done, fail) => http.close(error => error ? fail(error) : done()));
        db.close();
        rooms.clear();
        members.clear();
        absent.clear();
        limits.clear();
        log({ event: 'server_closed' });
      })();
      return shutdown;
    },
  };
}
