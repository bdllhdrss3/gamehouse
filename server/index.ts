import { resolve } from 'node:path';
import { createServer } from './app.js';

function integer(name: string, fallback: number) {
  const text = process.env[name];
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}.`);
  return value;
}
const port = integer('PORT', 3000);
if (port > 65535) throw new Error('Invalid PORT.');
const app = createServer({
  databasePath: process.env.DATABASE_PATH ?? resolve('data', 'games.sqlite'),
  distPath: resolve(process.env.DIST_PATH ?? 'dist'),
  origin: process.env.PUBLIC_ORIGIN,
  graceMs: integer('DISCONNECT_GRACE_MS', 15_000),
  roomTtlMs: integer('ROOM_TTL_MS', 86_400_000),
  maxRooms: integer('MAX_ROOMS', 250),
  maxConnections: integer('MAX_CONNECTIONS', 500),
  logger: entry => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
});
await app.listen(port, process.env.HOST ?? '0.0.0.0');
console.log(JSON.stringify({ event: 'listening', port }));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().catch(() => {
    console.error(JSON.stringify({ event: 'shutdown_failed' }));
    process.exitCode = 1;
  });
});
