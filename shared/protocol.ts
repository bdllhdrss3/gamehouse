import { z } from 'zod';
import { gameSchema, playerSchema, presetSchema } from './game.js';

export const protocolVersion = 1;
const envelope = {
  requestId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
};
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ ...envelope, type: z.literal('start') }).strict(),
  z.object({ ...envelope, type: z.literal('roll') }).strict(),
  z.object({ ...envelope, type: z.literal('move'), token: z.number().int().min(0).max(3) }).strict(),
  z.object({ ...envelope, type: z.literal('replace'), seat: z.string().min(1).max(64) }).strict(),
  z.object({ ...envelope, type: z.literal('bot'), add: z.boolean() }).strict(),
  z.object({ ...envelope, type: z.literal('lobby') }).strict(),
  z.object({ ...envelope, type: z.literal('leave') }).strict(),
  z.object({
    ...envelope,
    type: z.literal('profile'),
    name: z.string().trim().min(1).max(20),
    avatar: playerSchema.shape.avatar.default('bunny'),
    piece: playerSchema.shape.piece.default('king'),
  }).strict(),
  z.object({
    ...envelope,
    type: z.literal('shuffle'),
  }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const createSchema = z.object({
  protocol: z.literal(protocolVersion),
  requestId: z.string().uuid(),
  preset: presetSchema,
  boardSeed: z.number().int().min(0).max(999999).default(0),
  name: z.string().trim().min(1).max(20),
  avatar: playerSchema.shape.avatar.default('bunny'),
  piece: playerSchema.shape.piece.default('king'),
}).strict();
export const joinSchema = z.object({
  protocol: z.literal(protocolVersion),
  invitation: z.string().trim().min(6).max(64),
  name: z.string().trim().min(1).max(20),
  avatar: playerSchema.shape.avatar.default('bunny'),
  piece: playerSchema.shape.piece.default('king'),
  requestId: z.string().uuid().optional(),
}).strict();
export const roomSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  code: z.string(),
  invite: z.string(),
  preset: presetSchema,
  boardSeed: z.number().int().min(0).max(999999).default(0),
  revision: z.number().int().nonnegative(),
  host: z.string(),
  status: z.enum(['lobby', 'playing', 'results']),
  seats: z.array(playerSchema.extend({
    ready: z.boolean(),
    online: z.boolean(),
    absentSince: z.number().nullable(),
  })).max(4),
  game: gameSchema.nullable(),
  expiresAt: z.number(),
}).strict();
export type Room = z.infer<typeof roomSchema>;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; code: string; room?: Room };
export type RoomReply = Reply<{ room: Room; you: string }>;
