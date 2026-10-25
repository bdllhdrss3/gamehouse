import { z } from 'zod';

export const colors = ['red', 'green', 'yellow', 'blue'] as const;
export type Color = typeof colors[number];
export const presetSchema = z.enum(['ludo', 'classic', 'turbo']);
export type Preset = z.infer<typeof presetSchema>;
export const names: Record<Preset, string> = {
  ludo: 'Ludo', classic: 'Snakes & Ladders', turbo: 'Turbo ladders',
};
export const avatarIds = ['bunny', 'fox', 'frog', 'cat', 'panda', 'bear'] as const;
export const avatarSchema = z.enum(avatarIds);
export type AvatarId = z.infer<typeof avatarSchema>;
export const avatarInfo: Record<AvatarId, { label: string; face: string; tint: string }> = {
  bunny: { label: 'Bunny', face: '\u{1F430}', tint: '#fce5ed' },
  fox: { label: 'Fox', face: '\u{1F98A}', tint: '#ffead2' },
  frog: { label: 'Frog', face: '\u{1F438}', tint: '#e2f2c8' },
  cat: { label: 'Cat', face: '\u{1F431}', tint: '#fff0bd' },
  panda: { label: 'Panda', face: '\u{1F43C}', tint: '#e5e8f8' },
  bear: { label: 'Bear', face: '\u{1F43B}', tint: '#edddcc' },
};
export const chessPieceIds = ['king', 'queen', 'knight', 'rook', 'bishop', 'pawn'] as const;
export const chessPieceSchema = z.enum(chessPieceIds);
export type ChessPieceId = z.infer<typeof chessPieceSchema>;
export const chessPieceInfo: Record<ChessPieceId, { label: string; glyph: string }> = {
  king: { label: 'King', glyph: '\u265A' },
  queen: { label: 'Queen', glyph: '\u265B' },
  knight: { label: 'Knight', glyph: '\u265E' },
  rook: { label: 'Rook', glyph: '\u265C' },
  bishop: { label: 'Bishop', glyph: '\u265D' },
  pawn: { label: 'Pawn', glyph: '\u265F' },
};
export function suggestedName(random: number = Math.random()): string {
  const adjectives = ['Bouncy', 'Sunny', 'Sleepy', 'Lucky', 'Peppy', 'Cozy', 'Tiny', 'Happy'];
  const nouns = ['Mochi', 'Clover', 'Biscuit', 'Pebble', 'Pudding', 'Sprout', 'Noodle', 'Button'];
  const n = Math.floor(random * 4096);
  return `${adjectives[n % 8]} ${nouns[Math.floor(n / 8) % 8]} ${Math.floor(n / 64) + 1}`;
}
export const playerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(20),
  color: z.enum(colors),
  bot: z.boolean(),
  avatar: avatarSchema.default('bunny'),
  piece: chessPieceSchema.default('king'),
}).strict();
export type Player = z.infer<typeof playerSchema>;
const eventSchema = z.object({
  type: z.enum(['roll', 'move', 'ladder', 'snake', 'capture', 'home', 'pass', 'win']),
  text: z.string().max(200),
  player: z.number().int().min(0).max(3),
  token: z.number().int().min(0).max(3).optional(),
  path: z.array(z.number().int().min(-1).max(100)).max(110).optional(),
});
export type GameEvent = z.infer<typeof eventSchema>;
export const gameSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(64),
  preset: presetSchema,
  boardSeed: z.number().int().min(0).max(999999).default(0),
  players: z.array(playerSchema).min(2).max(4),
  positions: z.array(z.array(z.number().int().min(-1).max(100)).min(1).max(4)).min(2).max(4),
  turn: z.number().int().min(0).max(3),
  phase: z.enum(['roll', 'move', 'finished']),
  dice: z.number().int().min(1).max(6).nullable(),
  sixes: z.number().int().min(0).max(2),
  revision: z.number().int().nonnegative(),
  winner: z.number().int().min(0).max(3).nullable(),
  events: z.array(eventSchema).max(8),
}).strict().superRefine((g, ctx) => {
  const n = g.players.length;
  const expected = g.preset === 'ludo' ? 4 : 1;
  const min = g.preset === 'ludo' ? -1 : 0;
  const max = g.preset === 'ludo' ? 56 : g.preset === 'classic' ? 100 : 64;
  if (g.turn >= n || (g.winner !== null && g.winner >= n) ||
      g.positions.length !== n || g.positions.some(p => p.length !== expected || p.some(v => v < min || v > max)) ||
      new Set(g.players.map(p => p.id)).size !== n || new Set(g.players.map(p => p.color)).size !== n ||
      (g.phase === 'move' && (g.preset !== 'ludo' || g.dice === null)) ||
      (g.phase === 'finished') !== (g.winner !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid game state.' });
  }
});
export type Game = z.infer<typeof gameSchema>;
export type Action = { type: 'roll'; value: number } | { type: 'move'; token: number };

export const track: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],
  [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],
  [13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],
  [8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
export const starts: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const safe = new Set([0,8,13,21,26,34,39,47]);
export const homePaths: Record<Color, [number, number][]> = {
  red: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  green: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  blue: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
};
export function globalIndex(color: Color, progress: number): number | null {
  return progress < 0 || progress > 50 ? null : (starts[color] + progress) % 52;
}
export function ludoPoint(color: Color, token: number, progress: number): [number, number] {
  if (progress === -1) {
    const corner = { red: [0,0], green: [0,9], yellow: [9,9], blue: [9,0] }[color];
    return [corner[0] + 1.8 + Math.floor(token / 2) * 2, corner[1] + 1.8 + token % 2 * 2];
  }
  if (progress >= 51) return homePaths[color][progress - 51];
  return track[globalIndex(color, progress)!];
}

export interface Board { size: number; transports: Record<number, number>; title?: string }
export const boardVariants: Record<'classic' | 'turbo', Board[]> = {
  classic: [
    {
      size: 10,
      title: 'Royal Garden',
      transports: {
        2:38, 7:14, 8:31, 15:26, 21:42, 28:84, 36:44, 51:67, 71:91, 78:98, 87:94,
        16:6, 46:25, 49:11, 62:19, 64:60, 74:53, 89:68, 92:88, 95:75, 99:80,
      },
    },
    {
      size: 10,
      title: 'Emerald Climb',
      transports: {
        6:47, 9:28, 18:43, 21:60, 26:35, 29:10, 37:5, 46:65, 48:14,
        57:83, 59:79, 67:95, 69:31, 78:63, 80:40, 85:77, 87:55, 89:70,
      },
    },
    {
      size: 10,
      title: 'Crown Spire',
      transports: {
        3:39, 6:16, 13:53, 20:2, 24:64, 26:47, 32:50, 42:21, 44:37,
        46:14, 63:79, 66:96, 69:33, 81:61, 83:99, 85:76, 88:73, 90:71,
      },
    },
    {
      size: 10,
      title: 'Sunlit Valley',
      transports: {
        5:37, 7:28, 12:32, 20:42, 24:17, 31:11, 34:14, 39:3, 45:55,
        54:35, 62:82, 64:85, 69:93, 75:87, 81:60, 84:78, 88:67, 90:51,
      },
    },
  ],
  turbo: [
    {
      size: 8,
      title: 'Turbo Sprint',
      transports: {
        5:13, 10:23, 16:2, 19:30, 21:27, 33:63, 36:44, 38:54, 40:9,
        49:32, 51:61, 56:41,
      },
    },
    {
      size: 8,
      title: 'Sky Rocket',
      transports: {
        4:28, 9:26, 16:32, 22:6, 25:55, 29:51, 31:48, 38:59, 41:24,
        45:61, 50:34, 54:43,
      },
    },
    {
      size: 8,
      title: 'Starlight Leap',
      transports: {
        2:17, 8:26, 12:37, 18:3, 24:41, 27:7, 29:53, 34:46, 40:9,
        43:59, 49:31, 51:63,
      },
    },
    {
      size: 8,
      title: 'Lightning Path',
      transports: {
        2:18, 5:27, 10:39, 19:46, 21:13, 25:56, 32:16, 36:44, 38:11,
        41:23, 47:62, 52:60,
      },
    },
  ],
};
export const boards: Record<'classic' | 'turbo', Board> = {
  classic: boardVariants.classic[0],
  turbo: boardVariants.turbo[0],
};
export function getBoard(preset: 'classic' | 'turbo', seed = 0): Board {
  const list = boardVariants[preset];
  const idx = Math.abs(Math.trunc(seed)) % list.length;
  return list[idx];
}
export function boardPoint(position: number, size: number): [number, number] {
  const row = Math.floor((Math.max(1, position) - 1) / size);
  const col = (Math.max(1, position) - 1) % size;
  return [size - 1 - row, row % 2 === 0 ? col : size - 1 - col];
}
export function validateBoard(board: Board): void {
  const finish = board.size ** 2;
  for (const [key, to] of Object.entries(board.transports)) {
    const from = Number(key);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 1 || from >= finish ||
        to < 1 || to >= finish || from === to || board.transports[to] !== undefined) {
      throw new Error('Invalid snake/ladder endpoints.');
    }
  }
  const seen = new Set([0]);
  const queue = [0];
  for (const pos of queue) {
    for (let roll = 1; roll <= 6; roll++) {
      const landed = pos + roll;
      if (landed > finish) continue;
      const next = board.transports[landed] ?? landed;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  if (!seen.has(finish)) throw new Error('Finish is unreachable.');
}
Object.values(boardVariants).flat().forEach(validateBoard);

export function createGame(preset: Preset, players: Player[], id: string, boardSeed = 0): Game {
  return gameSchema.parse({
    version: 1, id, preset, boardSeed: Math.abs(Math.trunc(boardSeed)) % 1000000, players,
    positions: players.map(() => preset === 'ludo' ? [-1,-1,-1,-1] : [0]),
    turn: 0, phase: 'roll', dice: null, sixes: 0, revision: 0, winner: null, events: [],
  });
}
export function reachable(g: Game): { snakes: number[]; ladders: number[] } {
  if (g.preset === 'ludo' || g.phase !== 'roll') return { snakes: [], ladders: [] };
  const board = getBoard(g.preset, g.boardSeed);
  const from = g.positions[g.turn][0];
  const snakes: number[] = [], ladders: number[] = [];
  for (let roll = 1; roll <= 6; roll++) {
    const sq = from + roll, to = board.transports[sq];
    if (to === undefined) continue;
    (to < sq ? snakes : ladders).push(sq);
  }
  return { snakes, ladders };
}
export function legalMoves(g: Game): number[] {
  if (g.preset !== 'ludo' || g.phase !== 'move' || g.dice === null) return [];
  return g.positions[g.turn].flatMap((p, i) =>
    (p === -1 ? g.dice === 6 : p < 56 && p + g.dice! <= 56) ? [i] : []);
}
function nextTurn(g: Game, bonus = false): void {
  g.phase = 'roll';
  if (!bonus) { g.turn = (g.turn + 1) % g.players.length; g.sixes = 0; }
}
export function transition(state: Game, action: Action): Game {
  if (state.phase === 'finished') throw new Error('This match has finished.');
  const g: Game = { ...state, positions: state.positions.map(p => [...p]), events: [], revision: state.revision + 1 };
  const who = g.turn;
  const player = g.players[who];
  const emit = (type: GameEvent['type'], text: string, extra: Partial<GameEvent> = {}) =>
    g.events.push({ type, text, player: who, ...extra });
  if (action.type === 'roll') {
    if (g.phase !== 'roll') throw new Error('Choose a token before rolling again.');
    if (!Number.isInteger(action.value) || action.value < 1 || action.value > 6) throw new Error('Invalid dice value.');
    g.dice = action.value;
    emit('roll', `${player.name} rolled ${g.dice}.`);
    if (g.preset === 'ludo') {
      const sixes = g.dice === 6 ? g.sixes + 1 : 0;
      if (sixes === 3) {
        emit('pass', 'Three sixes! This roll is forfeited.');
        nextTurn(g);
        return g;
      }
      g.sixes = sixes;
      g.phase = 'move';
      if (!legalMoves(g).length) {
        emit('pass', `${player.name} has no legal move.`);
        nextTurn(g, g.dice === 6);
      }
      return g;
    }
    const board = getBoard(g.preset, g.boardSeed);
    const from = g.positions[who][0];
    const landed = from + g.dice;
    if (landed > board.size ** 2) {
      emit('pass', `${player.name} needs an exact roll to finish.`);
      nextTurn(g);
      return g;
    }
    const to = board.transports[landed] ?? landed;
    g.positions[who][0] = to;
    emit('move', `${player.name} reached square ${landed}.`, { token: 0, path: Array.from({ length: g.dice + 1 }, (_, i) => from + i) });
    if (to !== landed) emit(to > landed ? 'ladder' : 'snake', to > landed ? `Up the ladder to ${to}!` : `A little slide to ${to}.`, { token: 0, path: [landed, to] });
    if (to === board.size ** 2) {
      g.winner = who; g.phase = 'finished'; emit('win', `${player.name} wins!`);
    } else nextTurn(g);
    return g;
  }
  if (!legalMoves(g).includes(action.token)) throw new Error('That token cannot move.');
  const from = g.positions[who][action.token];
  const to = from === -1 ? 0 : from + g.dice!;
  g.positions[who][action.token] = to;
  emit('move', `${player.name} moved token ${action.token + 1}.`, {
    token: action.token, path: from === -1 ? [-1,0] : Array.from({ length: g.dice! + 1 }, (_, i) => from + i),
  });
  const idx = globalIndex(player.color, to);
  let captured = false;
  if (idx !== null && !safe.has(idx)) {
    g.players.forEach((other, p) => {
      if (p === who) return;
      g.positions[p] = g.positions[p].map(pos => {
        if (globalIndex(other.color, pos) !== idx) return pos;
        captured = true;
        return -1;
      });
    });
  }
  if (captured) emit('capture', `${player.name} sent a rival back home.`);
  if (to === 56) emit('home', 'One more token tucked safely home!');
  if (g.positions[who].every(p => p === 56)) {
    g.winner = who; g.phase = 'finished'; emit('win', `${player.name} wins!`);
  } else nextTurn(g, g.dice === 6 || captured || to === 56);
  return g;
}
export function botToken(g: Game): number {
  const legal = legalMoves(g);
  if (!legal.length) throw new Error('Bot has no legal move.');
  const color = g.players[g.turn].color;
  const score = (token: number) => {
    const from = g.positions[g.turn][token];
    const to = from === -1 ? 0 : from + g.dice!;
    const idx = globalIndex(color, to);
    const captures = idx !== null && !safe.has(idx) && g.players.some((p, i) =>
      i !== g.turn && g.positions[i].some(pos => globalIndex(p.color, pos) === idx));
    return (to === 56 ? 1000 : 0) + (captures ? 500 : 0) +
      (idx !== null && safe.has(idx) ? 100 : 0) + (from === -1 ? 80 : 0) + to;
  };
  return legal.reduce((best, token) => score(token) > score(best) ? token : best);
}
export function localPlayers(count: number, solo: boolean, name: string, avatar: AvatarId = 'bunny', piece: ChessPieceId = 'king'): Player[] {
  const order: Color[] = count === 2 ? ['red', 'yellow'] : [...colors];
  return order.slice(0, count).map((color, i) => ({
    id: `local-${i}`, color, bot: solo && i > 0,
    avatar: i === 0 ? avatar : avatarIds[i],
    piece: i === 0 ? piece : chessPieceIds[i % chessPieceIds.length],
    name: i === 0 ? name : solo ? ['','Mochi','Pip','Clover'][i] : `Player ${i + 1}`,
  }));
}
