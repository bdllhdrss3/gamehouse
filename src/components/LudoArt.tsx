import { memo, useId } from 'react';
import { colors, homePaths, safe, starts, track, type Color } from '../../shared/game';
import { BoardFrame, Vignette, boardThemes, darken, lighten, type BoardThemeId } from './themes';

export const boardColors: Record<Color, string> = { red: '#e14b5a', green: '#2fa66a', yellow: '#f2b62b', blue: '#3b82d6' };
const bases: Record<Color, [number, number]> = { red: [0, 0], green: [360, 0], yellow: [360, 360], blue: [0, 360] };
const C = 40;

function star(cx: number, cy: number, outer: number, inner: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    return `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join('') + 'Z';
}

export const LudoArt = memo(function LudoArt({ themeId = 'meadow' }: { themeId?: BoardThemeId }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const theme = boardThemes[themeId];
  const dark = theme.vignette > 0.3;
  const startColor = (i: number) => (Object.entries(starts).find(([, v]) => v === i)?.[0] as Color | undefined);
  return <g>
    <defs>
      {colors.map(color => <linearGradient key={color} id={`${uid}-${color}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={lighten(boardColors[color], 0.22)} /><stop offset="1" stopColor={darken(boardColors[color], 0.08)} />
      </linearGradient>)}
      {colors.map(color => <radialGradient key={color} id={`${uid}-pocket-${color}`} cx=".5" cy=".38" r=".62">
        <stop offset="0" stopColor={lighten(boardColors[color], 0.55)} /><stop offset="1" stopColor={lighten(boardColors[color], 0.2)} />
      </radialGradient>)}
      <linearGradient id={`${uid}-tile`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={lighten(theme.track, theme.lift * 0.6)} /><stop offset="1" stopColor={theme.track} />
      </linearGradient>
      <linearGradient id={`${uid}-yard`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={theme.yard} /><stop offset="1" stopColor={lighten(theme.yard, dark ? 0.08 : 0)} />
      </linearGradient>
    </defs>
    <BoardFrame theme={theme} uid={uid} />
    {colors.map(color => {
      const [x, y] = bases[color];
      return <g key={color}>
        <rect x={x + 2} y={y + 2} width="236" height="236" rx="18" fill={`url(#${uid}-${color})`} stroke={darken(boardColors[color], 0.35)} strokeWidth="2" />
        <rect x={x + 8} y={y + 8} width="224" height="224" rx="14" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity=".35" />
        <rect x={x + 34} y={y + 37} width="172" height="172" rx="28" fill="#000000" opacity=".18" />
        <rect x={x + 34} y={y + 34} width="172" height="172" rx="28" fill={`url(#${uid}-yard)`} stroke={darken(boardColors[color], 0.3)} strokeWidth="2" />
        {[0, 1, 2, 3].map(t => {
          const cx = x + 92 + (t % 2) * 80, cy = y + 92 + Math.floor(t / 2) * 80;
          return <g key={t}>
            <circle cx={cx} cy={cy} r="27" fill={darken(boardColors[color], 0.12)} />
            <circle cx={cx} cy={cy + 1.5} r="22" fill="#000000" opacity=".22" />
            <circle cx={cx} cy={cy} r="21" fill={`url(#${uid}-pocket-${color})`} />
          </g>;
        })}
      </g>;
    })}
    {track.map(([r, c], i) => {
      const owner = startColor(i);
      const x = c * C, y = r * C;
      const next = track[(i + 1) % track.length];
      const dx = next[1] - c, dy = next[0] - r;
      return <g key={i}>
        <rect x={x + 1} y={y + 1} width={C - 2} height={C - 2} rx="5" fill={owner ? `url(#${uid}-${owner})` : `url(#${uid}-tile)`} stroke={dark ? '#00000055' : '#c9bea4'} strokeWidth=".8" />
        <rect x={x + 3} y={y + 3} width={C - 6} height={C - 6} rx="4" fill="none" stroke="#ffffff" strokeWidth="1" opacity={dark ? 0.12 : 0.6} />
        {owner && <path d={`M${x + 20 + dx * 9} ${y + 20 + dy * 9}L${x + 20 - dx * 5 - dy * 7} ${y + 20 - dy * 5 + dx * 7}L${x + 20 - dx * 5 + dy * 7} ${y + 20 - dy * 5 - dx * 7}Z`} fill="#ffffff" opacity=".9" />}
        {safe.has(i) && !owner && <path d={star(x + 20, y + 20, 13, 5.6)} fill="#f4c542" stroke="#9a6b00" strokeWidth="1.3" strokeLinejoin="round" />}
      </g>;
    })}
    {colors.map(color => homePaths[color].slice(0, 5).map(([r, c]) => <g key={`${color}-${r}-${c}`}>
      <rect x={c * C + 1} y={r * C + 1} width={C - 2} height={C - 2} rx="5" fill={`url(#${uid}-${color})`} stroke={darken(boardColors[color], 0.3)} strokeWidth=".8" />
      <rect x={c * C + 3} y={r * C + 3} width={C - 6} height={C - 6} rx="4" fill="none" stroke="#ffffff" strokeWidth="1" opacity=".45" />
    </g>))}
    <rect x="240" y="240" width="120" height="120" fill={theme.bed} />
    {([['red', 'M240 240L300 300L240 360Z'], ['green', 'M240 240L360 240L300 300Z'], ['yellow', 'M360 240L360 360L300 300Z'], ['blue', 'M240 360L360 360L300 300Z']] as const).map(([color, d]) =>
      <path key={color} d={d} fill={`url(#${uid}-${color})`} stroke={darken(boardColors[color], 0.35)} strokeWidth="1.5" strokeLinejoin="round" />)}
    <circle cx="300" cy="300" r="24" fill="#000000" opacity=".2" />
    <circle cx="300" cy="298" r="23" fill="#fff6dc" stroke="#9a6b00" strokeWidth="2" />
    <path d={star(300, 298, 15, 6.5)} fill="#f4c542" stroke="#9a6b00" strokeWidth="1.4" strokeLinejoin="round" />
    <Vignette theme={theme} uid={uid} />
  </g>;
});
