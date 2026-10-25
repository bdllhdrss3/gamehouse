import { describe, expect, it } from 'vitest';
import { boardVariants, boards, botToken, createGame, gameSchema, getBoard, globalIndex, homePaths, legalMoves, localPlayers, ludoPoint, reachable, safe, starts, suggestedName, track, transition, validateBoard, type Game } from '../shared/game';

const create = (preset: Game['preset'] = 'ludo', n = 2, seed = 0) => createGame(preset, localPlayers(n, true, 'Sunny Clover', 'fox', 'queen'), 'test-game', seed);
function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
describe('profiles and initialization', () => {
  it('keeps chosen avatar, chess piece, and opposite colors for two players', () => {
    const g = create();
    expect(g.players.map(p => p.color)).toEqual(['red', 'yellow']);
    expect(g.players[0].avatar).toBe('fox');
    expect(g.players[0].piece).toBe('queen');
  });
  it('suggests readable names within nickname limits', () => {
    const names = Array.from({ length: 4096 }, (_, n) => suggestedName(n / 4096));
    expect(new Set(names).size).toBe(4096);
    expect(names.every(n => n.length <= 20)).toBe(true);
  });
  it('rejects corrupt saves', () => {
    const g = create(); g.positions[0] = [999];
    expect(gameSchema.safeParse(g).success).toBe(false);
  });
});
describe('Ludo geometry', () => {
  it('has 52 unique adjacent outer squares and correctly joins every home lane', () => {
    expect(track).toHaveLength(52);
    expect(new Set(track.map(p => p.join(','))).size).toBe(52);
    for (let i = 0; i < 52; i++) {
      const a = track[i], b = track[(i+1)%52];
      expect(Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]))).toBe(1);
    }
    for (const color of Object.keys(starts) as Array<keyof typeof starts>) {
      expect(ludoPoint(color,0,0)).toEqual(track[starts[color]]);
      const a = ludoPoint(color,0,50), b = homePaths[color][0];
      expect(Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1])).toBe(1);
      expect(ludoPoint(color,0,56)).toEqual(homePaths[color][5]);
    }
  });
});
describe('Ludo transitions', () => {
  it('requires six to deploy; no-move passes, six deploys to zero', () => {
    const original = create();
    expect(transition(original,{type:'roll',value:3}).turn).toBe(1);
    const rolled = transition(original,{type:'roll',value:6});
    expect(legalMoves(rolled)).toEqual([0,1,2,3]);
    const moved = transition(rolled,{type:'move',token:0});
    expect(moved.positions[0][0]).toBe(0);
    expect(moved.turn).toBe(0);
    expect(original.positions[0]).toEqual([-1,-1,-1,-1]);
  });
  it('forfeits third six without undoing earlier moves', () => {
    let g = create();
    for (let n=0;n<2;n++) { g=transition(g,{type:'roll',value:6}); g=transition(g,{type:'move',token:0}); }
    const before = g.positions[0][0];
    g=transition(g,{type:'roll',value:6});
    expect(g.turn).toBe(1); expect(g.positions[0][0]).toBe(before); expect(g.sixes).toBe(0);
  });
  it('captures rival stacks on unsafe squares and grants only one extra roll', () => {
    const g = create();
    g.positions = [[3,-1,-1,-1],[31,31,-1,-1]];
    const moved = transition(transition(g,{type:'roll',value:2}),{type:'move',token:0});
    expect(globalIndex('red',5)).toBe(globalIndex('yellow',31));
    expect(moved.positions[1]).toEqual([-1,-1,-1,-1]);
    expect(moved.turn).toBe(0); expect(moved.phase).toBe('roll');
  });
  it('allows safe-square coexistence and friendly stacks without blockades', () => {
    const g = create(); g.positions = [[7,8,-1,-1],[34,-1,-1,-1]];
    const moved = transition(transition(g,{type:'roll',value:1}),{type:'move',token:0});
    expect(safe.has(8)).toBe(true); expect(moved.positions[1][0]).toBe(34);
    expect(moved.positions[0].slice(0,2)).toEqual([8,8]);
    expect(moved.turn).toBe(1);
  });
  it('requires exact finish, excludes finished tokens, and wins deterministically', () => {
    const g = create(); g.positions[0] = [55,56,56,56];
    const overshoot = transition(g,{type:'roll',value:2});
    expect(overshoot.turn).toBe(1);
    const win = transition(transition(g,{type:'roll',value:1}),{type:'move',token:0});
    expect(win.phase).toBe('finished'); expect(win.winner).toBe(0);
    expect(() => transition(win,{type:'roll',value:1})).toThrow();
  });
  it('resets six count on non-six even with a capture bonus', () => {
    const g = create(); g.sixes=2; g.positions=[[3,-1,-1,-1],[31,-1,-1,-1]];
    const result = transition(transition(g,{type:'roll',value:2}),{type:'move',token:0});
    expect(result.turn).toBe(0); expect(result.sixes).toBe(0);
  });
  it('rejects wrong phases, illegal tokens, and bad dice', () => {
    const g = create();
    expect(() => transition(g,{type:'move',token:0})).toThrow();
    for (const value of [0,7,1.5,NaN]) expect(() => transition(g,{type:'roll',value})).toThrow();
    const rolled=transition(g,{type:'roll',value:6});
    expect(() => transition(rolled,{type:'roll',value:6})).toThrow();
    expect(() => transition(rolled,{type:'move',token:4})).toThrow();
  });
});
describe('Snakes and Ladders', () => {
  it('validates layouts, supports shuffled board variants, prevents ambiguous endpoints, and requires a reachable finish', () => {
    Object.values(boardVariants).flat().forEach(b => expect(() => validateBoard(b)).not.toThrow());
    expect(getBoard('classic', 0).title).not.toBe(getBoard('classic', 1).title);
    expect(getBoard('turbo', 0).title).not.toBe(getBoard('turbo', 1).title);
    expect(() => validateBoard({size:8,transports:{2:3,3:4}})).toThrow();
    expect(() => validateBoard({size:8,transports:{64:4}})).toThrow();
  });
  it('moves from zero, climbs once, slides once, and does not bonus on six', () => {
    const g=create('classic');
    const climbed=transition(g,{type:'roll',value:2});
    expect(climbed.positions[0][0]).toBe(38); expect(climbed.turn).toBe(1);
    g.positions[0][0]=10;
    const slide=transition(g,{type:'roll',value:6});
    expect(slide.positions[0][0]).toBe(6); expect(slide.turn).toBe(1);
  });
  it('reports snakes and ladders reachable with the next roll only during the roll phase', () => {
    const g = create('classic');
    expect(reachable(g)).toEqual({ snakes: [], ladders: [2] });
    g.positions[0][0] = 10;
    expect(reachable(g)).toEqual({ snakes: [16], ladders: [15] });
    expect(reachable(transition(create(), { type: 'roll', value: 6 }))).toEqual({ snakes: [], ladders: [] });
  });
  it('keeps every Turbo layout faster than every Classic layout', () => {
    const median = (board: { size: number; transports: Record<number, number> }) => {
      const turns: number[] = [];
      for (let s = 1; s <= 3000; s++) {
        const random = seeded(s); let pos = 0, n = 0;
        while (pos !== board.size ** 2 && n < 5000) { const l = pos + 1 + Math.floor(random() * 6); if (l <= board.size ** 2) pos = board.transports[l] ?? l; n++; }
        turns.push(n);
      }
      return turns.sort((a, b) => a - b)[1500];
    };
    const slowestTurbo = Math.max(...boardVariants.turbo.map(median));
    const fastestClassic = Math.min(...boardVariants.classic.map(median));
    expect(slowestTurbo).toBeLessThan(fastestClassic);
  });
  it('stays on overshoot and wins on exact finish', () => {
    const g=create('turbo'); g.positions[0][0]=63;
    expect(transition(g,{type:'roll',value:2}).positions[0][0]).toBe(63);
    expect(transition(g,{type:'roll',value:1}).winner).toBe(0);
  });
});
describe('invariants and measured Turbo', () => {
  it('completes deterministic bot matches for every seat count and preset', () => {
    const random = seeded(334);
    for (const preset of ['ludo','classic','turbo'] as const) for (const count of [2,3,4]) {
      let g=create(preset,count);
      let actions=0;
      while (g.phase !== 'finished' && actions++ < 15000) {
        const old=JSON.stringify(g);
        const next=transition(g,g.phase==='move'?{type:'move',token:botToken(g)}:{type:'roll',value:1+Math.floor(random()*6)});
        expect(JSON.stringify(g)).toBe(old);
        expect(gameSchema.safeParse(next).success).toBe(true);
        expect(next.revision).toBe(g.revision+1); g=next;
      }
      expect(g.phase).toBe('finished');
    }
  });
  it('Turbo median is <= 70% of Classic, with a lower p90 and zero capped runs', () => {
    const simulate=(preset:'classic'|'turbo') => {
      const board=boards[preset], turns:number[]=[];
      let capped=0;
      for(let seed=1;seed<=10000;seed++) {
        const random=seeded(seed); let pos=0, turn=0;
        while(pos!==board.size**2 && turn<10000) {
          const landed=pos+1+Math.floor(random()*6);
          if(landed<=board.size**2) pos=board.transports[landed]??landed;
          turn++;
        }
        if(turn===10000) capped++;
        turns.push(turn);
      }
      turns.sort((a,b)=>a-b);
      return {median:turns[5000],p90:turns[9000],capped};
    };
    const classic=simulate('classic'), turbo=simulate('turbo');
    console.info('10,000 seeded runs per layout:',JSON.stringify({classic,turbo}));
    expect(classic.capped+turbo.capped).toBe(0);
    expect(turbo.median).toBeLessThanOrEqual(classic.median*.7);
    expect(turbo.p90).toBeLessThan(classic.p90);
  });
});
