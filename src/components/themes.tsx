import { z } from 'zod';

export const boardThemeIds = ['meadow', 'jungle', 'midnight', 'volcano'] as const;
export const boardThemeSchema = z.enum(boardThemeIds);
export type BoardThemeId = z.infer<typeof boardThemeSchema>;

export interface BoardTheme {
  label: string;
  blurb: string;
  frame: [string, string, string];
  rim: string;
  bed: string;
  base: string;
  tiles: string[];
  lift: number;
  num: string;
  numStroke: string;
  tag: string;
  start: string;
  finish: string;
  track: string;
  yard: string;
  decor: 'none' | 'vines' | 'stars' | 'embers';
  vignette: number;
}

export const boardThemes: Record<BoardThemeId, BoardTheme> = {
  meadow: {
    label: 'Sunny Meadow', blurb: 'Bright and cheerful',
    frame: ['#b5753a', '#8a5426', '#5f3816'], rim: '#f2c46d', bed: '#6b4220',
    base: '#fff8e6', tiles: ['#ffb4a8', '#ffd98a', '#b9e79f', '#9fd2ff', '#d2bfff'], lift: 0.38,
    num: '#4a3220', numStroke: '#fffaf0', tag: '#5a3a12', start: '#8be0a4', finish: '#ffd447',
    track: '#fbf4e2', yard: '#fffaf0', decor: 'none', vignette: 0,
  },
  jungle: {
    label: 'Jungle Ruins', blurb: 'Mossy stones and vines',
    frame: ['#6b7a3c', '#454f22', '#262c10'], rim: '#cdb65a', bed: '#2a3115',
    base: '#e9ecd0', tiles: ['#9fc98a', '#d9c27a', '#80b8a2', '#c9a37c', '#b3cf6b'], lift: 0.3,
    num: '#2b2a14', numStroke: '#f4f1d6', tag: '#3d3a12', start: '#6fcf97', finish: '#f2c94c',
    track: '#ecebd3', yard: '#f4f2df', decor: 'vines', vignette: 0.25,
  },
  midnight: {
    label: 'Midnight Manor', blurb: 'Dark, eerie, suspenseful',
    frame: ['#4d3878', '#2a1d47', '#120a24'], rim: '#b99cff', bed: '#0c0819',
    base: '#2c2649', tiles: ['#53306b', '#263f6d', '#1f4c4e', '#5f2c41', '#3b3374'], lift: 0.16,
    num: '#f4ecff', numStroke: '#120b22', tag: '#ffe7a3', start: '#2e8a62', finish: '#c9a227',
    track: '#3b3459', yard: '#262040', decor: 'stars', vignette: 0.55,
  },
  volcano: {
    label: 'Lava Peak', blurb: 'Hot embers, high stakes',
    frame: ['#6e2e18', '#3d170c', '#1a0803'], rim: '#ff8a3d', bed: '#150805',
    base: '#3d2b26', tiles: ['#7d2d1a', '#5c3c2b', '#8f4b1c', '#4e2727', '#6d3425'], lift: 0.2,
    num: '#ffe9cc', numStroke: '#1c0904', tag: '#ffcf7a', start: '#2f7a4a', finish: '#e0a020',
    track: '#4b3631', yard: '#2f201c', decor: 'embers', vignette: 0.5,
  },
};

export function lighten(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
export function darken(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

const decorPoints = Array.from({ length: 34 }, (_, i) => {
  const side = i % 4, t = ((i * 37) % 97) / 97;
  const along = -10 + t * 620;
  const across = -10 + ((i * 13) % 7) * 0.9;
  return side === 0 ? [along, across] : side === 1 ? [610 - (across + 10), along] : side === 2 ? [along, 610 - (across + 10)] : [across, along];
});

export function BoardFrame({ theme, uid }: { theme: BoardTheme; uid: string }) {
  return <>
    <defs>
      <linearGradient id={`${uid}-frame`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={theme.frame[0]} /><stop offset=".5" stopColor={theme.frame[1]} /><stop offset="1" stopColor={theme.frame[2]} />
      </linearGradient>
      <radialGradient id={`${uid}-vignette`} cx=".5" cy=".5" r=".72">
        <stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity={theme.vignette} />
      </radialGradient>
    </defs>
    <rect x="-15" y="-15" width="630" height="630" rx="28" fill={`url(#${uid}-frame)`} />
    {theme.decor === 'stars' && decorPoints.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1.6 : 0.9} fill="#fff6d6" opacity={0.45 + (i % 3) * 0.2} />)}
    {theme.decor === 'embers' && decorPoints.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 1.8 : 1.1} fill={i % 2 ? '#ffb347' : '#ff5a1f'} opacity=".8" />)}
    {theme.decor === 'vines' && decorPoints.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="4" ry="1.8" transform={`rotate(${(i * 47) % 180} ${x} ${y})`} fill={i % 2 ? '#8fbf4d' : '#5f8f2f'} opacity=".9" />)}
    <rect x="-9" y="-9" width="618" height="618" rx="23" fill="none" stroke={theme.rim} strokeWidth="2.5" opacity=".85" />
    <rect x="-3" y="-3" width="606" height="606" rx="17" fill={theme.bed} />
  </>;
}

export function Vignette({ theme, uid }: { theme: BoardTheme; uid: string }) {
  return theme.vignette ? <rect x="-3" y="-3" width="606" height="606" rx="17" fill={`url(#${uid}-vignette)`} pointerEvents="none" /> : null;
}
