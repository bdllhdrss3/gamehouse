import { memo, useId } from 'react';
import { boardPoint, getBoard, type Board } from '../../shared/game';
import { BoardFrame, Vignette, boardThemes, lighten, type BoardThemeId } from './themes';

type Pt = [number, number];
const SIZE = 600;
const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

const snakePalettes = [
  { body: '#2fa35f', dark: '#155c34', belly: '#c8f5a0', mark: '#ffd84d', pattern: 'spots' },
  { body: '#e2475f', dark: '#7a1426', belly: '#ffd2c2', mark: '#fff1c9', pattern: 'bands' },
  { body: '#8b5cf6', dark: '#3f1d8f', belly: '#e7dcff', mark: '#5eead4', pattern: 'spots' },
  { body: '#f08a24', dark: '#7a3b06', belly: '#ffe8bf', mark: '#5b2a06', pattern: 'bands' },
  { body: '#2f8fdc', dark: '#123f6b', belly: '#d4ecff', mark: '#ffe066', pattern: 'spots' },
] as const;

function center(position: number, size: number): Pt {
  const cell = SIZE / size;
  const [r, c] = boardPoint(position, size);
  return [c * cell + cell / 2, r * cell + cell / 2];
}

function snakeGeometry(head: Pt, tail: Pt, cell: number, index: number) {
  const dx = tail[0] - head[0], dy = tail[1] - head[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const halfWaves = Math.max(1, Math.round(len / (cell * 1.8)));
  const amp = Math.min(cell * 0.55, len * 0.22) * (index % 2 ? -1 : 1);
  const W = cell * 0.27;
  const N = 72;
  const mid: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const off = amp * Math.sin(Math.PI * t * halfWaves) * Math.pow(Math.sin(Math.PI * t), 0.55);
    mid.push([head[0] + dx * t + nx * off, head[1] + dy * t + ny * off]);
  }
  const width = (t: number) => t < 0.12 ? W * (0.82 + 1.5 * t) : W * Math.max(0.09, 1 - Math.pow((t - 0.12) / 0.88, 1.5) * 0.93);
  const normals: Pt[] = mid.map((_, i) => {
    const a = mid[Math.max(0, i - 1)], b = mid[Math.min(N, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [-ty / l, tx / l];
  });
  const at = (i: number, factor: number): Pt => {
    const w = width(i / N);
    return [mid[i][0] + normals[i][0] * w * factor, mid[i][1] + normals[i][1] * w * factor];
  };
  const left = mid.map((_, i) => at(i, 0.5));
  const right = mid.map((_, i) => at(i, -0.5));
  const end = mid[N], before = mid[N - 1];
  const el = Math.hypot(end[0] - before[0], end[1] - before[1]) || 1;
  const tip: Pt = [end[0] + (end[0] - before[0]) / el * cell * 0.12, end[1] + (end[1] - before[1]) / el * cell * 0.12];
  const body = `M${f(left[0])}${left.slice(1).map(p => `L${f(p)}`).join('')}L${f(tip)}${[...right].reverse().map(p => `L${f(p)}`).join('')}Z`;
  const line = (factor: number, from: number, to: number) => {
    const pts: string[] = [];
    for (let i = Math.round(from * N); i <= Math.round(to * N); i++) pts.push(f(at(i, factor)));
    return `M${pts.join('L')}`;
  };
  const marks: { a: Pt; b: Pt; c: Pt; w: number; angle: number }[] = [];
  for (let i = 9; i < N * 0.86; i += 6) {
    const angle = Math.atan2(normals[i][0], -normals[i][1]) * 180 / Math.PI;
    marks.push({ a: at(i, 0.42), b: at(i, -0.42), c: mid[i], w: width(i / N), angle });
  }
  return { body, belly: line(-0.2, 0.06, 0.9), gloss: line(0.27, 0.08, 0.8), marks, W };
}

function Snake({ head, tail, cell, index }: { head: Pt; tail: Pt; cell: number; index: number }) {
  const pal = snakePalettes[index % snakePalettes.length];
  const g = snakeGeometry(head, tail, cell, index);
  const R = g.W * 1.08;
  const outline = Math.max(1.6, cell * 0.035);
  return <g className="sl-snake">
    <path d={g.body} transform="translate(3 5)" fill="#2b1a0c" opacity=".22" />
    <path d={g.body} fill={pal.body} stroke={pal.dark} strokeWidth={outline} strokeLinejoin="round" />
    <path d={g.belly} fill="none" stroke={pal.belly} strokeWidth={g.W * 0.3} strokeLinecap="round" opacity=".7" />
    {g.marks.map((m, i) => pal.pattern === 'bands'
      ? <path key={i} d={`M${f(m.a)}L${f(m.b)}`} stroke={pal.mark} strokeWidth={m.w * 0.24} strokeLinecap="round" opacity=".9" />
      : <ellipse key={i} cx={m.c[0]} cy={m.c[1]} rx={m.w * 0.27} ry={m.w * 0.19} transform={`rotate(${m.angle} ${m.c[0]} ${m.c[1]})`} fill={pal.mark} stroke={pal.dark} strokeWidth={outline * 0.45} />)}
    <path d={g.gloss} fill="none" stroke="#ffffff" strokeWidth={g.W * 0.11} strokeLinecap="round" opacity=".42" />
    <g transform={`translate(${head[0]} ${head[1]})`}>
      <path d={`M0 ${R * 0.62}L0 ${R * 1.12}M0 ${R * 1.12}L${-R * 0.16} ${R * 1.34}M0 ${R * 1.12}L${R * 0.16} ${R * 1.34}`} stroke="#e11d48" strokeWidth={Math.max(1.6, cell * 0.032)} strokeLinecap="round" fill="none" />
      <ellipse cx="2" cy="4" rx={R * 1.12} ry={R * 0.95} fill="#2b1a0c" opacity=".22" />
      <ellipse rx={R * 1.12} ry={R * 0.93} fill={pal.body} stroke={pal.dark} strokeWidth={outline} />
      <ellipse cy={R * 0.34} rx={R * 0.72} ry={R * 0.42} fill={pal.belly} opacity=".95" />
      <ellipse cx={-R * 0.45} cy={-R * 0.6} rx={R * 0.32} ry={R * 0.16} fill="#ffffff" opacity=".4" />
      {[-1, 1].map(s => <g key={s}>
        <ellipse cx={s * R * 0.72} cy={R * 0.22} rx={R * 0.17} ry={R * 0.1} fill="#ff7a93" opacity=".75" />
        <circle cx={s * R * 0.42} cy={-R * 0.22} r={R * 0.31} fill="#ffffff" stroke={pal.dark} strokeWidth={outline * 0.75} />
        <circle cx={s * R * 0.42 + R * 0.04} cy={-R * 0.15} r={R * 0.17} fill="#1d2433" />
        <circle cx={s * R * 0.42 + R * 0.1} cy={-R * 0.24} r={R * 0.065} fill="#ffffff" />
        <circle cx={s * R * 0.13} cy={R * 0.2} r={R * 0.05} fill={pal.dark} />
      </g>)}
      <path d={`M${-R * 0.3} ${R * 0.43}Q0 ${R * 0.7} ${R * 0.3} ${R * 0.43}`} stroke={pal.dark} strokeWidth={outline * 0.8} strokeLinecap="round" fill="none" />
    </g>
  </g>;
}

function Ladder({ foot, top, cell }: { foot: Pt; top: Pt; cell: number }) {
  const dx = top[0] - foot[0], dy = top[1] - foot[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy * cell * 0.17, ny = ux * cell * 0.17;
  const a: Pt = [foot[0] - ux * cell * 0.2, foot[1] - uy * cell * 0.2];
  const b: Pt = [top[0] + ux * cell * 0.2, top[1] + uy * cell * 0.2];
  const rails = `M${f([a[0] + nx, a[1] + ny])}L${f([b[0] + nx, b[1] + ny])}M${f([a[0] - nx, a[1] - ny])}L${f([b[0] - nx, b[1] - ny])}`;
  const highlight = `M${f([a[0] + nx * 1.12, a[1] + ny * 1.12])}L${f([b[0] + nx * 1.12, b[1] + ny * 1.12])}M${f([a[0] - nx * 0.88, a[1] - ny * 0.88])}L${f([b[0] - nx * 0.88, b[1] - ny * 0.88])}`;
  const count = Math.max(2, Math.round((len + cell * 0.4) / (cell * 0.4)));
  const rungs = Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { l: [p[0] + nx, p[1] + ny] as Pt, r: [p[0] - nx, p[1] - ny] as Pt };
  });
  const rungPath = rungs.map(r => `M${f(r.l)}L${f(r.r)}`).join('');
  return <g className="sl-ladder">
    <path d={rails + rungPath} transform="translate(3 5)" stroke="#2b1a0c" strokeWidth={cell * 0.1} strokeLinecap="round" opacity=".22" fill="none" />
    <path d={rungPath} stroke="#5f3410" strokeWidth={cell * 0.095} strokeLinecap="round" fill="none" />
    <path d={rungPath} stroke="#e7a65b" strokeWidth={cell * 0.06} strokeLinecap="round" fill="none" />
    <path d={rails} stroke="#5f3410" strokeWidth={cell * 0.115} strokeLinecap="round" fill="none" />
    <path d={rails} stroke="#c97f36" strokeWidth={cell * 0.075} strokeLinecap="round" fill="none" />
    <path d={highlight} stroke="#f7cf8d" strokeWidth={cell * 0.022} strokeLinecap="round" fill="none" opacity=".9" />
    {rungs.flatMap((r, i) => [r.l, r.r].map((p, j) => <circle key={`${i}-${j}`} cx={p[0]} cy={p[1]} r={cell * 0.022} fill="#4a280b" />))}
  </g>;
}

function Crown({ x, y, scale }: { x: number; y: number; scale: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-1 .45L-1.08-.42-.52-.02 0-.72.52-.02 1.08-.42 1 .45Z" fill="#ffc31f" stroke="#8a5600" strokeWidth=".09" strokeLinejoin="round" />
    <rect x="-1.04" y=".38" width="2.08" height=".3" rx=".1" fill="#f5a400" stroke="#8a5600" strokeWidth=".09" />
    <circle cy=".1" r=".14" fill="#e63950" />
    {[-1.08, 0, 1.08].map(cx => <circle key={cx} cx={cx} cy={cx === 0 ? -0.78 : -0.48} r=".12" fill="#fff4c2" stroke="#8a5600" strokeWidth=".06" />)}
  </g>;
}

function describe(board: Board) {
  const entries = Object.entries(board.transports).map(([s, t]) => [Number(s), t] as const).sort((a, b) => a[0] - b[0]);
  const ladders = entries.filter(([s, t]) => t > s).map(([s, t]) => `${s} to ${t}`).join(', ');
  const snakes = entries.filter(([s, t]) => t < s).map(([s, t]) => `${s} to ${t}`).join(', ');
  return `Ladders: ${ladders}. Snakes: ${snakes}.`;
}

export const SnakesArt = memo(function SnakesArt({ preset, seed, themeId = 'meadow' }: { preset: 'classic' | 'turbo'; seed: number; themeId?: BoardThemeId }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const theme = boardThemes[themeId];
  const board = getBoard(preset, seed);
  const n = board.size;
  const cell = SIZE / n;
  const entries = Object.entries(board.transports).map(([s, t]) => [Number(s), t] as const);
  const gradient = (k: number) => `url(#${uid}-tile${k})`;
  const fills = [theme.base, ...theme.tiles, theme.start, theme.finish];
  const textStyle = { fill: theme.num, stroke: theme.numStroke };
  return <g>
    <desc>{describe(board)}</desc>
    <defs>
      {fills.map((color, k) => <linearGradient key={k} id={`${uid}-tile${k}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={lighten(color, theme.lift)} /><stop offset="1" stopColor={color} />
      </linearGradient>)}
    </defs>
    <BoardFrame theme={theme} uid={uid} />
    {Array.from({ length: n * n }, (_, i) => {
      const sq = i + 1;
      const [r, c] = boardPoint(sq, n);
      const x = c * cell, y = r * cell;
      const start = sq === 1, finish = sq === n * n;
      const k = start ? fills.length - 2 : finish ? fills.length - 1 : (r + c) % 2 === 0 ? 0 : 1 + (r % theme.tiles.length);
      return <g key={sq}>
        <rect x={x + 1.2} y={y + 1.2} width={cell - 2.4} height={cell - 2.4} rx={cell * 0.13} fill={gradient(k)} />
        <rect x={x + 3.5} y={y + 3.5} width={cell - 7} height={cell - 7} rx={cell * 0.1} fill="none" stroke="#ffffff" strokeWidth="1.2" opacity={theme.vignette > 0.3 ? 0.18 : 0.55} />
        <text x={x + cell * 0.11} y={y + cell * 0.3} className="sl-num" style={textStyle} fontSize={cell * 0.24}>{sq}</text>
        {start && <text x={x + cell / 2} y={y + cell * 0.86} textAnchor="middle" className="sl-tag" style={{ fill: theme.tag }} fontSize={cell * 0.17}>START</text>}
        {finish && <>
          <Crown x={x + cell / 2} y={y + cell * 0.55} scale={cell * 0.24} />
          <text x={x + cell / 2} y={y + cell * 0.93} textAnchor="middle" className="sl-tag" style={{ fill: theme.tag }} fontSize={cell * 0.15}>WIN</text>
        </>}
      </g>;
    })}
    {entries.filter(([s, t]) => t > s).map(([s, t]) => <Ladder key={`l${s}`} foot={center(s, n)} top={center(t, n)} cell={cell} />)}
    {entries.filter(([s, t]) => t < s).map(([s, t], i) => <Snake key={`s${s}`} head={center(s, n)} tail={center(t, n)} cell={cell} index={i} />)}
    <Vignette theme={theme} uid={uid} />
  </g>;
});
