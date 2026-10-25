import { Fragment } from 'react';
import { SnakesArt } from './SnakesArt';
import { LudoArt, boardColors } from './LudoArt';
import { darken, type BoardThemeId } from './themes';
import { boardPoint, chessPieceInfo, colors, getBoard, legalMoves, ludoPoint, reachable, type ChessPieceId, type Color, type Game } from '../../shared/game';

const marks: Record<Color, string> = { red: '●', green: '▲', yellow: '◆', blue: '■' };
export function PlayerMark({ color }: { color: Color }) {
  return <span className={`player-mark ${color}`} aria-label={`${color} ${({ red: 'circle', green: 'triangle', yellow: 'diamond', blue: 'square' })[color]}`}>{marks[color]}</span>;
}

const chessPathMap: Record<ChessPieceId, JSX.Element> = {
  king: (
    <g>
      <path d="M-1.5 -16H1.5V-13H4.5V-10H1.5V-7.5H-1.5V-10H-4.5V-13H-1.5Z" />
      <path d="M-7 -7.5C-7 -10.5 7 -10.5 7 -7.5L5.5 4.5H-5.5Z" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-10" y="7.5" width="20" height="3.5" rx="1.75" />
    </g>
  ),
  queen: (
    <g>
      <circle cx="-7" cy="-11" r="1.8" />
      <circle cx="0" cy="-13" r="2" />
      <circle cx="7" cy="-11" r="1.8" />
      <path d="M-8 -9L-4 -3L0 -10L4 -3L8 -9L6 4.5H-6Z" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-10" y="7.5" width="20" height="3.5" rx="1.75" />
    </g>
  ),
  knight: (
    <g>
      <path d="M-6 4.5V-4C-6 -9 -2 -13 4 -13L6 -15L7 -11C9 -9 9 -5 5 -3C2 -1.5 1 0 3 4.5Z" />
      <circle cx="2.2" cy="-8.5" r="1.3" fill="#fffcf5" stroke="none" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-10" y="7.5" width="20" height="3.5" rx="1.75" />
    </g>
  ),
  rook: (
    <g>
      <path d="M-7 -11H-4V-8H-1.5V-11H1.5V-8H4V-11H7V-5.5L5.2 -3.5V4.5H-5.2V-3.5L-7 -5.5Z" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-10" y="7.5" width="20" height="3.5" rx="1.75" />
    </g>
  ),
  bishop: (
    <g>
      <circle cx="0" cy="-13.5" r="2" />
      <path d="M0 -11C-5.5 -8 -6 -1.5 -4.5 4.5H4.5C6 -1.5 5.5 -8 0 -11Z" />
      <path d="M-2.2 -5.5L2.5 -1" stroke="#fffcf5" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-10" y="7.5" width="20" height="3.5" rx="1.75" />
    </g>
  ),
  pawn: (
    <g>
      <circle cx="0" cy="-9.5" r="4.5" />
      <path d="M-3.5 -4.5C-2 -1 -4.5 1.5 -5.5 4.5H5.5C4.5 1.5 2 -1 3.5 -4.5Z" />
      <rect x="-8" y="4.5" width="16" height="3" rx="1.5" />
      <rect x="-9.5" y="7.5" width="19" height="3.5" rx="1.75" />
    </g>
  ),
};

const PAWN = 'M-11 10C-11 5.5-6 4.5-5 1C-4-2-5-4-6.5-6H6.5C5-4 4-2 5 1C6 4.5 11 5.5 11 10Z';
const pawnSilhouette = <>
  <path d={PAWN} /><ellipse cy="10" rx="11" ry="3.6" /><ellipse cy="-6.5" rx="7.5" ry="2.6" /><circle cy="-13" r="7.2" />
</>;

function Piece({ x, y, color, number, label, onClick, legal, glow, hop, pointer, chessPiece, scale = 1 }: {
  x: number; y: number; color: Color; number: number; label: string; onClick?: () => void;
  legal?: boolean; glow?: boolean; hop?: boolean; pointer?: boolean; chessPiece?: ChessPieceId; scale?: number;
}) {
  const fill = boardColors[color];
  const edge = darken(fill, 0.5);
  const silhouette = chessPiece ? chessPathMap[chessPiece] : pawnSilhouette;
  return <g className={`board-piece ${color} ${legal ? 'legal' : ''} ${glow ? 'glowing' : ''}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
    <g transform={`scale(${scale})`}>
      {glow && <g className="piece-glow" style={{ fill }}>
        <circle r="27" opacity=".22" /><circle r="20" opacity=".3" /><circle r="20" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity=".9" />
      </g>}
      {legal && <circle r="22" className="legal-ring" />}
      <ellipse cy="12.5" rx="13" ry="4.2" fill="#140c05" opacity=".4" className={hop ? 'hop-shadow' : ''} />
      <g className={hop ? 'piece-hop' : ''}>
        <g fill="#1b1209" stroke="#1b1209" strokeWidth="9" strokeLinejoin="round">{silhouette}</g>
        <g fill="#ffffff" stroke="#ffffff" strokeWidth="5.5" strokeLinejoin="round">{silhouette}</g>
        {chessPiece ? <>
          <g fill={fill} stroke={edge} strokeWidth="1.4" strokeLinejoin="round">{chessPathMap[chessPiece]}</g>
          <ellipse cx="-3" cy="-6" rx="2" ry="4.5" fill="#ffffff" opacity=".45" />
        </> : <>
          <path d={PAWN} fill={fill} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
          <ellipse cy="10" rx="11" ry="3.6" fill={darken(fill, 0.15)} stroke={edge} strokeWidth="1.4" />
          <ellipse cy="-6.5" rx="7.5" ry="2.6" fill={darken(fill, 0.1)} stroke={edge} strokeWidth="1.2" />
          <circle cy="-13" r="7.2" fill={fill} stroke={edge} strokeWidth="1.4" />
          <ellipse cx="-2.6" cy="-15.4" rx="2.6" ry="1.9" fill="#ffffff" opacity=".75" />
          <path d="M-6 7C-5.5 4-3.5 2.5-3 .5" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".5" />
        </>}
        <circle cx="10" cy="-12" r="6.5" fill="#fffcf5" stroke="#1b1209" strokeWidth="1.6" />
        <text x="10" y="-11.5" dominantBaseline="central" textAnchor="middle" className="chess-badge-text">{number}</text>
      </g>
      {pointer && <g className="piece-pointer">
        <path d="M-9-44H9L0-31Z" fill={fill} stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round" />
      </g>}
      {onClick ? <g role="button" tabIndex={-1} aria-label={label} onClick={onClick} className="piece-hit">
        <circle r="26" fill="transparent" />
      </g> : <title>{label}</title>}
    </g>
  </g>;
}

export function LudoBoard({ game, onToken, preview = false, theme = 'meadow', idle = true, turnLabel }: { game?: Game; onToken?: (n: number) => void; preview?: boolean; theme?: BoardThemeId; idle?: boolean; turnLabel?: string }) {
  const valid = game ? legalMoves(game) : [];
  const activeColor = game && game.phase !== 'finished' ? game.players[game.turn]?.color : undefined;
  const pieces = (game ? game.players.flatMap((p, i) => game.positions[i].map((position, token) => ({ color: p.color, name: p.name, player: i, position, token }))) :
    colors.flatMap((color, i) => [0,1,2,3].map(token => ({ color, name: color, player: i, position: token === 0 ? 3 + i * 4 : -1, token }))))
    .map(p => {
      const isTurn = !preview && !!game && game.turn === p.player && game.phase !== 'finished';
      return { ...p, isTurn, legal: !!onToken && isTurn && valid.includes(p.token) };
    })
    .sort((a, b) => Number(a.isTurn) - Number(b.isTurn) || Number(a.legal) - Number(b.legal));
  const overlap = new Map<string, number>();
  const baseOrigin: Record<Color, [number, number]> = { red: [0, 0], green: [360, 0], yellow: [360, 360], blue: [0, 360] };
  return <svg viewBox="-16 -16 632 632" className="game-board ludo-board" role="img" aria-label={preview ? 'Colorful Ludo board preview' : 'Ludo board. Tap a bouncing piece on the board or use the token buttons below.'}>
    <LudoArt themeId={theme} />
    {!preview && activeColor && (() => {
      const [bx, by] = baseOrigin[activeColor];
      return <g className="active-base" style={{ ['--turn-color' as string]: boardColors[activeColor] }}>
        <rect x={bx + 2} y={by + 2} width="236" height="236" rx="18" className="active-base-glow" />
        <rect x={bx + 6} y={by + 6} width="228" height="228" rx="16" className="active-base-ring" />
        {turnLabel && <g transform={`translate(${bx + 120} ${by + 19})`}>
          <rect x="-58" y="-12" width="116" height="24" rx="12" fill="#1b1209" stroke="#ffffff" strokeWidth="2" />
          <text textAnchor="middle" dominantBaseline="central" className="base-turn-text">{turnLabel}</text>
        </g>}
      </g>;
    })()}
    {pieces.map(p => {
      const [r, c] = ludoPoint(p.color, p.token, p.position);
      const key = `${r},${c}`;
      const n = overlap.get(key) ?? 0;
      overlap.set(key, n + 1);
      return <Piece key={`${p.color}-${p.token}`} x={c * 40 + 20 + (n % 2) * 12 - (n > 0 ? 6 : 0)} y={r * 40 + 20 + Math.floor(n / 2) * 12}
        color={p.color} number={p.token + 1} legal={p.legal} glow={p.isTurn && (p.legal || game?.phase === 'roll')} hop={p.legal && idle} scale={1.28}
        onClick={p.legal ? () => onToken!(p.token) : undefined}
        label={`${p.name}, token ${p.token + 1}, ${p.position === -1 ? 'in base' : p.position === 56 ? 'finished' : `step ${p.position}`}`} />;
    })}
  </svg>;
}

export function SnakesBoard({ game, turbo = false, boardSeed = 0, preview = false, theme = 'meadow', idle = true }: { game?: Game; turbo?: boolean; boardSeed?: number; preview?: boolean; theme?: BoardThemeId; idle?: boolean }) {
  const preset = game?.preset === 'turbo' || turbo ? 'turbo' : 'classic';
  const seed = game ? game.boardSeed : boardSeed;
  const board = getBoard(preset, seed);
  const n = board.size;
  const cell = 600 / n;
  const point = (pos: number): [number, number] => {
    const [r, c] = boardPoint(pos, n);
    return [c * cell + cell / 2, r * cell + cell / 2];
  };
  const players = game?.players ?? [
    { color: 'red' as const, name: 'Bunny', piece: 'king' as ChessPieceId },
    { color: 'yellow' as const, name: 'Fox', piece: 'knight' as ChessPieceId },
  ];
  const reach = game && !preview ? reachable(game) : { snakes: [], ladders: [] };
  const zone = (sq: number, kind: 'danger' | 'boost') => {
    const [r, c] = boardPoint(sq, n);
    return <rect key={`${kind}-${sq}`} x={c * cell + 2} y={r * cell + 2} width={cell - 4} height={cell - 4} rx={cell * 0.13} className={`reach-${kind}`} />;
  };
  const order = players.map((_, i) => i).sort((a, b) => Number(game?.turn === a) - Number(game?.turn === b));
  return <svg viewBox="-16 -16 632 632" className="game-board snakes-board" role="img" aria-label={preview ? 'Snakes and Ladders board preview' : `Snakes and Ladders, ${n * n} squares, ${board.title ?? 'Classic'} layout. Your positions are listed below.`}>
    <SnakesArt preset={preset} seed={seed} themeId={theme} />
    {reach.snakes.map(sq => zone(sq, 'danger'))}
    {reach.ladders.map(sq => zone(sq, 'boost'))}
    {order.map(i => {
      const p = players[i];
      const pos = game?.positions[i][0] ?? [12, 34][i];
      const [x, y] = point(pos || 1);
      const isTurn = !preview && game?.turn === i && game.phase !== 'finished';
      const pieceId = p.piece ?? 'king';
      const spread = cell * 0.17;
      return <Fragment key={i}><Piece x={x + (i % 2 ? spread : -spread)} y={y + (i < 2 ? -spread * 0.4 : spread * 0.6)} color={p.color} number={i + 1}
        glow={isTurn} hop={isTurn && idle} pointer={isTurn && idle} chessPiece={pieceId} scale={preview ? cell / 50 : cell / 34}
        label={`${p.name} (${chessPieceInfo[pieceId].label}), ${pos === 0 ? 'waiting at start' : `square ${pos}`}`} /></Fragment>;
    })}
  </svg>;
}
export default function GameBoard(props: { game: Game; onToken?: (token: number) => void; theme?: BoardThemeId; idle?: boolean; turnLabel?: string }) {
  return props.game.preset === 'ludo' ? <LudoBoard {...props} /> : <SnakesBoard game={props.game} theme={props.theme} idle={props.idle} />;
}
