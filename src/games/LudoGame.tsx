import React, { useState, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Trophy,
  RotateCcw,
  Home,
  Bot,
  User,
  Star,
  Sparkles,
  ShieldCheck,
  Crown,
} from 'lucide-react';
import { PlayerConfig, PlayerColor, PLAYER_PALETTE } from '../types';
import { Dice } from '../components/Dice';
import { sound } from '../utils/sound';

interface LudoGameProps {
  players: PlayerConfig[];
  onBackToHub: () => void;
}

// 52-cell clockwise outer perimeter coordinates [row, col] on a 15x15 grid
const MAIN_TRACK: [number, number][] = [
  // Left arm top row (moving right) - Red starts at index 0 -> [6, 1]
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  // Top arm left col (moving up)
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  // Top middle
  [0, 7],
  // Top arm right col (moving down) - Green starts at index 13 -> [1, 8]
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  // Right arm top row (moving right)
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  // Right middle
  [7, 14],
  // Right arm bottom row (moving left) - Yellow starts at index 26 -> [8, 13]
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  // Bottom arm right col (moving down)
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  // Bottom middle
  [14, 7],
  // Bottom arm left col (moving up) - Blue starts at index 39 -> [13, 6]
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  // Left arm bottom row (moving left)
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  // Left middle
  [7, 0],
  // Corner before [6, 1]
  [6, 0],
];

const START_TRACK_INDEX: Record<PlayerColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

// Safe global track indices (4 start squares + 4 star squares)
const SAFE_TRACK_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Home stretch coordinates for steps 51..55 (56 is goal)
const HOME_STRETCH_COORDS: Record<PlayerColor, [number, number][]> = {
  red: [
    [7, 1], [7, 2], [7, 3], [7, 4], [7, 5],
  ],
  green: [
    [1, 7], [2, 7], [3, 7], [4, 7], [5, 7],
  ],
  yellow: [
    [7, 13], [7, 12], [7, 11], [7, 10], [7, 9],
  ],
  blue: [
    [13, 7], [12, 7], [11, 7], [10, 7], [9, 7],
  ],
};

// Base pocket coordinates for each player's 4 tokens (when progress === -1)
const BASE_POCKET_COORDS: Record<PlayerColor, [number, number][]> = {
  red: [
    [1.8, 1.8],
    [1.8, 3.6],
    [3.6, 1.8],
    [3.6, 3.6],
  ],
  green: [
    [1.8, 10.4],
    [1.8, 12.2],
    [3.6, 10.4],
    [3.6, 12.2],
  ],
  yellow: [
    [10.4, 10.4],
    [10.4, 12.2],
    [12.2, 10.4],
    [12.2, 12.2],
  ],
  blue: [
    [10.4, 1.8],
    [10.4, 3.6],
    [12.2, 1.8],
    [12.2, 3.6],
  ],
};

// Goal positions inside the 3x3 center (when progress === 56)
const GOAL_POCKET_COORDS: Record<PlayerColor, [number, number][]> = {
  red: [
    [6.7, 6.2],
    [7.3, 6.2],
    [6.5, 6.5],
    [7.5, 6.5],
  ],
  green: [
    [6.2, 6.7],
    [6.2, 7.3],
    [6.5, 6.5],
    [6.5, 7.5],
  ],
  yellow: [
    [6.7, 7.8],
    [7.3, 7.8],
    [6.5, 7.5],
    [7.5, 7.5],
  ],
  blue: [
    [7.8, 6.7],
    [7.8, 7.3],
    [7.5, 6.5],
    [7.5, 7.5],
  ],
};

export interface LudoToken {
  color: PlayerColor;
  tokenIndex: number; // 0..3
  progress: number; // -1 = in base, 0..50 = outer track, 51..55 = home path, 56 = finished
}

function getGlobalTrackIndex(color: PlayerColor, progress: number): number | null {
  if (progress < 0 || progress > 50) return null;
  return (START_TRACK_INDEX[color] + progress) % 52;
}

function getTokenGridCoords(token: LudoToken): [number, number] {
  if (token.progress === -1) {
    return BASE_POCKET_COORDS[token.color][token.tokenIndex];
  }
  if (token.progress === 56) {
    return GOAL_POCKET_COORDS[token.color][token.tokenIndex];
  }
  if (token.progress >= 51 && token.progress <= 55) {
    return HOME_STRETCH_COORDS[token.color][token.progress - 51];
  }
  const globalIdx = getGlobalTrackIndex(token.color, token.progress)!;
  return MAIN_TRACK[globalIdx];
}

export const LudoGame: React.FC<LudoGameProps> = ({ players, onBackToHub }) => {
  const activePlayers = players.filter((p) => p.active);

  const createInitialTokens = (): Record<PlayerColor, LudoToken[]> => {
    const map: Record<PlayerColor, LudoToken[]> = {
      red: [],
      green: [],
      yellow: [],
      blue: [],
    };
    (['red', 'green', 'yellow', 'blue'] as PlayerColor[]).forEach((color) => {
      map[color] = [0, 1, 2, 3].map((i) => ({
        color,
        tokenIndex: i,
        progress: -1,
      }));
    });
    return map;
  };

  const [tokensByColor, setTokensByColor] = useState<Record<PlayerColor, LudoToken[]>>(
    createInitialTokens
  );
  const [turnIndex, setTurnIndex] = useState(0);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [phase, setPhase] = useState<'ROLL' | 'MOVE' | 'ANIMATING' | 'GAMEOVER'>('ROLL');
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const [winner, setWinner] = useState<PlayerConfig | null>(null);
  const [logs, setLogs] = useState<string[]>([
    'Roll a 6 to deploy a token from your home base!',
  ]);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const currentPlayer = activePlayers[turnIndex] || activePlayers[0];

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [msg, ...prev.slice(0, 14)]);
  }, []);

  // Determine which tokens of a player can legally move for a given dice roll
  const getValidTokenMoves = useCallback(
    (color: PlayerColor, roll: number, stateMap = tokensByColor): number[] => {
      const list = stateMap[color];
      const valid: number[] = [];
      list.forEach((tok) => {
        if (tok.progress === -1) {
          if (roll === 6) valid.push(tok.tokenIndex);
        } else if (tok.progress + roll <= 56) {
          valid.push(tok.tokenIndex);
        }
      });
      return valid;
    },
    [tokensByColor]
  );

  const nextTurn = useCallback(
    (grantBonusTurn: boolean) => {
      if (grantBonusTurn) {
        setDiceValue(null);
        setPhase('ROLL');
        return;
      }
      setConsecutiveSixes(0);
      setDiceValue(null);
      setTurnIndex((prev) => (prev + 1) % activePlayers.length);
      setPhase('ROLL');
    },
    [activePlayers.length]
  );

  // Execute token move with step-by-step animation
  const executeTokenMove = useCallback(
    async (tokenIndex: number, rollValue: number) => {
      if (phase !== 'MOVE') return;
      const color = currentPlayer.color;
      const token = tokensByColor[color][tokenIndex];
      if (!token) return;

      // Validate move
      if (token.progress === -1 && rollValue !== 6) return;
      if (token.progress >= 0 && token.progress + rollValue > 56) return;

      setPhase('ANIMATING');

      const stepsToAnimate = token.progress === -1 ? 1 : rollValue;
      let currentProgress = token.progress;

      for (let s = 0; s < stepsToAnimate; s++) {
        currentProgress = currentProgress === -1 ? 0 : currentProgress + 1;
        sound.playStep(s);

        setTokensByColor((prev) => ({
          ...prev,
          [color]: prev[color].map((t) =>
            t.tokenIndex === tokenIndex ? { ...t, progress: currentProgress } : t
          ),
        }));

        await new Promise((r) => setTimeout(r, 150));
        if (!isMounted.current) return;
      }

      // Check capture on main track (0..50)
      let capturedOpponent = false;
      const landedGlobalIdx = getGlobalTrackIndex(color, currentProgress);

      if (landedGlobalIdx !== null && !SAFE_TRACK_INDICES.has(landedGlobalIdx)) {
        const updatedMap: Record<PlayerColor, LudoToken[]> = { ...tokensByColor };
        updatedMap[color] = updatedMap[color].map((t) =>
          t.tokenIndex === tokenIndex ? { ...t, progress: currentProgress } : t
        );

        activePlayers.forEach((otherPlayer) => {
          if (otherPlayer.color === color) return;
          const opponentTokens = updatedMap[otherPlayer.color];
          // Find opponent tokens on this exact global square
          const matchingOpponents = opponentTokens.filter(
            (ot) => getGlobalTrackIndex(otherPlayer.color, ot.progress) === landedGlobalIdx
          );

          // In standard Ludo, single opponent token (or any on non-safe) gets captured
          if (matchingOpponents.length > 0) {
            capturedOpponent = true;
            updatedMap[otherPlayer.color] = opponentTokens.map((ot) =>
              getGlobalTrackIndex(otherPlayer.color, ot.progress) === landedGlobalIdx
                ? { ...ot, progress: -1 }
                : ot
            );
            addLog(
              `💥 ${currentPlayer.name} captured ${otherPlayer.name}'s token!`
            );
          }
        });

        if (capturedOpponent) {
          sound.playCapture();
          setTokensByColor(updatedMap);
        }
      }

      // Check if token reached goal (56)
      const reachedHome = currentProgress === 56;
      if (reachedHome) {
        sound.playSixBonus();
        addLog(`🏠 ${currentPlayer.name} brought a token home!`);
      } else if (token.progress === -1) {
        addLog(`🚀 ${currentPlayer.name} deployed a token onto the track.`);
      } else {
        addLog(`${currentPlayer.name} advanced ${rollValue} spaces.`);
      }

      // Check win condition (all 4 tokens at progress === 56)
      let allFinished = false;
      setTokensByColor((latest) => {
        allFinished = latest[color].every((t) =>
          t.tokenIndex === tokenIndex ? currentProgress === 56 : t.progress === 56
        );
        return latest;
      });

      if (allFinished) {
        sound.playWinFanfare();
        confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 } });
        setWinner(currentPlayer);
        setPhase('GAMEOVER');
        addLog(`🏆 ${currentPlayer.name} wins the Ludo Championship!`);
        return;
      }

      const bonusTurn = rollValue === 6 || capturedOpponent || reachedHome;
      if (bonusTurn) {
        addLog(`✨ Bonus roll granted to ${currentPlayer.name}!`);
      }

      nextTurn(bonusTurn);
    },
    [
      phase,
      currentPlayer,
      tokensByColor,
      activePlayers,
      addLog,
      nextTurn,
    ]
  );

  // Smart AI decision function for choosing the best token move
  const chooseBestBotToken = useCallback(
    (color: PlayerColor, roll: number): number => {
      const validIndices = getValidTokenMoves(color, roll);
      if (validIndices.length <= 1) return validIndices[0];

      let bestIdx = validIndices[0];
      let bestScore = -9999;

      validIndices.forEach((idx) => {
        const tok = tokensByColor[color][idx];
        let score = 0;
        const targetProgress = tok.progress === -1 ? 0 : tok.progress + roll;

        // 1. Reaching exact home goal (56)
        if (targetProgress === 56) {
          score += 500;
        }

        // 2. Capturing an opponent token
        const targetGlobal = getGlobalTrackIndex(color, targetProgress);
        if (targetGlobal !== null && !SAFE_TRACK_INDICES.has(targetGlobal)) {
          activePlayers.forEach((op) => {
            if (op.color === color) return;
            const hasVictim = tokensByColor[op.color].some(
              (ot) => getGlobalTrackIndex(op.color, ot.progress) === targetGlobal
            );
            if (hasVictim) score += 420;
          });
        }

        // 3. Deploying a token out of base on a 6
        if (tok.progress === -1 && roll === 6) {
          score += 260;
        }

        // 4. Landing on a safe star square or home stretch
        if (
          (targetGlobal !== null && SAFE_TRACK_INDICES.has(targetGlobal)) ||
          targetProgress >= 51
        ) {
          score += 140;
        }

        // 5. Leaving a safe square penalty
        const currentGlobal = getGlobalTrackIndex(color, tok.progress);
        if (currentGlobal !== null && SAFE_TRACK_INDICES.has(currentGlobal)) {
          score -= 55;
        }

        // 6. Prefer advancing the furthest token
        score += tok.progress * 2;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });

      return bestIdx;
    },
    [getValidTokenMoves, tokensByColor, activePlayers]
  );

  // Roll the dice
  const handleRollDice = useCallback(() => {
    if (phase !== 'ROLL' || rolling) return;
    setRolling(true);
    sound.playDiceRoll();

    setTimeout(() => {
      if (!isMounted.current) return;
      const rolled = Math.floor(Math.random() * 6) + 1;
      setRolling(false);
      setDiceValue(rolled);

      if (rolled === 6) {
        sound.playSixBonus();
      }

      const nextSixCount = rolled === 6 ? consecutiveSixes + 1 : 0;
      setConsecutiveSixes(nextSixCount);

      if (nextSixCount >= 3) {
        addLog(`⚠️ ${currentPlayer.name} rolled three 6s in a row — turn forfeited!`);
        setTimeout(() => {
          if (isMounted.current) nextTurn(false);
        }, 900);
        return;
      }

      const validMoves = getValidTokenMoves(currentPlayer.color, rolled);
      if (validMoves.length === 0) {
        addLog(`${currentPlayer.name} rolled ${rolled} — no valid moves.`);
        setTimeout(() => {
          if (isMounted.current) nextTurn(false);
        }, 850);
        return;
      }

      setPhase('MOVE');
    }, 450);
  }, [
    phase,
    rolling,
    consecutiveSixes,
    currentPlayer,
    getValidTokenMoves,
    addLog,
    nextTurn,
  ]);

  // Auto-handle AI Bot turns & single-option human auto-moves
  useEffect(() => {
    if (phase === 'ROLL' && !rolling && currentPlayer.type === 'bot') {
      const timer = setTimeout(() => {
        handleRollDice();
      }, 650);
      return () => clearTimeout(timer);
    }

    if (phase === 'MOVE' && diceValue !== null) {
      const validMoves = getValidTokenMoves(currentPlayer.color, diceValue);

      if (currentPlayer.type === 'bot') {
        const chosen = chooseBestBotToken(currentPlayer.color, diceValue);
        const timer = setTimeout(() => {
          executeTokenMove(chosen, diceValue);
        }, 550);
        return () => clearTimeout(timer);
      } else if (validMoves.length === 1) {
        // Check if all valid moves are identical (e.g. only 1 token can move)
        const timer = setTimeout(() => {
          executeTokenMove(validMoves[0], diceValue);
        }, 380);
        return () => clearTimeout(timer);
      }
    }
  }, [
    phase,
    rolling,
    currentPlayer,
    diceValue,
    handleRollDice,
    getValidTokenMoves,
    chooseBestBotToken,
    executeTokenMove,
  ]);

  // Keyboard spacebar shortcut for human dice roll
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        phase === 'ROLL' &&
        !rolling &&
        currentPlayer.type === 'human'
      ) {
        e.preventDefault();
        handleRollDice();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, rolling, currentPlayer, handleRollDice]);

  const resetGame = () => {
    setTokensByColor(createInitialTokens());
    setTurnIndex(0);
    setDiceValue(null);
    setRolling(false);
    setPhase('ROLL');
    setConsecutiveSixes(0);
    setWinner(null);
    setLogs(['New Ludo match started! Roll a 6 to deploy from base.']);
  };

  // Compute all active tokens with their board coordinates and stacking offsets
  const allRenderedTokens: {
    token: LudoToken;
    coords: [number, number];
    isMovable: boolean;
    stackIndex: number;
    stackTotal: number;
  }[] = [];

  const cellGroups = new Map<string, { token: LudoToken; coords: [number, number]; isMovable: boolean }[]>();

  activePlayers.forEach((p) => {
    const validForCurrent =
      phase === 'MOVE' &&
      diceValue !== null &&
      currentPlayer.color === p.color
        ? getValidTokenMoves(p.color, diceValue)
        : [];

    tokensByColor[p.color].forEach((tok) => {
      const coords = getTokenGridCoords(tok);
      const key = `${coords[0].toFixed(1)},${coords[1].toFixed(1)}`;
      const isMovable = validForCurrent.includes(tok.tokenIndex);
      if (!cellGroups.has(key)) cellGroups.set(key, []);
      cellGroups.get(key)!.push({ token: tok, coords, isMovable });
    });
  });

  cellGroups.forEach((group) => {
    group.forEach((item, idx) => {
      allRenderedTokens.push({
        ...item,
        stackIndex: idx,
        stackTotal: group.length,
      });
    });
  });

  // Helper to style individual track cells on the 15x15 grid
  const getTrackCellInfo = (r: number, c: number) => {
    // Check if it's a home stretch cell
    if (r === 7 && c >= 1 && c <= 5) return { bg: '#ef4444', safe: false, startColor: null };
    if (c === 7 && r >= 1 && r <= 5) return { bg: '#22c55e', safe: false, startColor: null };
    if (r === 7 && c >= 9 && c <= 13) return { bg: '#eab308', safe: false, startColor: null };
    if (c === 7 && r >= 9 && r <= 13) return { bg: '#3b82f6', safe: false, startColor: null };

    // Check if it's one of the 4 colored start squares
    if (r === 6 && c === 1) return { bg: '#ef4444', safe: true, startColor: 'red' as PlayerColor };
    if (r === 1 && c === 8) return { bg: '#22c55e', safe: true, startColor: 'green' as PlayerColor };
    if (r === 8 && c === 13) return { bg: '#eab308', safe: true, startColor: 'yellow' as PlayerColor };
    if (r === 13 && c === 6) return { bg: '#3b82f6', safe: true, startColor: 'blue' as PlayerColor };

    // Check if it's one of the 4 star safe squares
    const isStarSquare =
      (r === 2 && c === 6) ||
      (r === 6 && c === 12) ||
      (r === 12 && c === 8) ||
      (r === 8 && c === 2);

    return {
      bg: isStarSquare ? '#fef3c7' : '#f8fafc',
      safe: isStarSquare,
      startColor: null,
    };
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
      {/* Left / Main Board Area */}
      <div className="relative w-full max-w-[620px] aspect-square bg-slate-900 p-2.5 sm:p-4 rounded-3xl shadow-2xl border-2 border-slate-800">
        <div className="relative w-full h-full grid grid-cols-15 grid-rows-15 rounded-2xl overflow-hidden border-2 border-slate-950 bg-slate-200 shadow-inner"
          style={{
            gridTemplateColumns: 'repeat(15, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(15, minmax(0, 1fr))',
          }}
        >
          {/* Red Base (Top-Left 6x6) */}
          <div
            style={{ gridColumn: '1 / span 6', gridRow: '1 / span 6' }}
            className="bg-red-500 p-2.5 sm:p-4 border-r-2 border-b-2 border-slate-900 flex items-center justify-center relative"
          >
            <div className="w-full h-full bg-white rounded-2xl shadow-inner grid grid-cols-2 grid-rows-2 p-2 sm:p-3 gap-2 sm:gap-3 place-items-center">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-3/4 aspect-square rounded-full bg-red-100 border-2 border-red-400 shadow-inner"
                />
              ))}
            </div>
          </div>

          {/* Green Base (Top-Right 6x6) */}
          <div
            style={{ gridColumn: '10 / span 6', gridRow: '1 / span 6' }}
            className="bg-green-500 p-2.5 sm:p-4 border-l-2 border-b-2 border-slate-900 flex items-center justify-center relative"
          >
            <div className="w-full h-full bg-white rounded-2xl shadow-inner grid grid-cols-2 grid-rows-2 p-2 sm:p-3 gap-2 sm:gap-3 place-items-center">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-3/4 aspect-square rounded-full bg-green-100 border-2 border-green-400 shadow-inner"
                />
              ))}
            </div>
          </div>

          {/* Blue Base (Bottom-Left 6x6) */}
          <div
            style={{ gridColumn: '1 / span 6', gridRow: '10 / span 6' }}
            className="bg-blue-500 p-2.5 sm:p-4 border-r-2 border-t-2 border-slate-900 flex items-center justify-center relative"
          >
            <div className="w-full h-full bg-white rounded-2xl shadow-inner grid grid-cols-2 grid-rows-2 p-2 sm:p-3 gap-2 sm:gap-3 place-items-center">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-3/4 aspect-square rounded-full bg-blue-100 border-2 border-blue-400 shadow-inner"
                />
              ))}
            </div>
          </div>

          {/* Yellow Base (Bottom-Right 6x6) */}
          <div
            style={{ gridColumn: '10 / span 6', gridRow: '10 / span 6' }}
            className="bg-amber-400 p-2.5 sm:p-4 border-l-2 border-t-2 border-slate-900 flex items-center justify-center relative"
          >
            <div className="w-full h-full bg-white rounded-2xl shadow-inner grid grid-cols-2 grid-rows-2 p-2 sm:p-3 gap-2 sm:gap-3 place-items-center">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-3/4 aspect-square rounded-full bg-amber-100 border-2 border-amber-400 shadow-inner"
                />
              ))}
            </div>
          </div>

          {/* Center 3x3 Home Goal Triangles */}
          <div
            style={{ gridColumn: '7 / span 3', gridRow: '7 / span 3' }}
            className="relative border-2 border-slate-900 overflow-hidden"
          >
            <svg viewBox="0 0 100 100" className="w-full h-full block">
              {/* Red Left Triangle */}
              <polygon points="0,0 50,50 0,100" fill="#ef4444" stroke="#0f172a" strokeWidth="1.5" />
              {/* Green Top Triangle */}
              <polygon points="0,0 100,0 50,50" fill="#22c55e" stroke="#0f172a" strokeWidth="1.5" />
              {/* Yellow Right Triangle */}
              <polygon points="100,0 100,100 50,50" fill="#eab308" stroke="#0f172a" strokeWidth="1.5" />
              {/* Blue Bottom Triangle */}
              <polygon points="0,100 100,100 50,50" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />
              <circle cx="50" cy="50" r="14" fill="#ffffff" stroke="#0f172a" strokeWidth="2" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Crown className="w-4 h-4 text-amber-500" />
            </div>
          </div>

          {/* Render Track Cells */}
          {Array.from({ length: 15 }).map((_, r) =>
            Array.from({ length: 15 }).map((__, c) => {
              const inBase =
                (r < 6 && c < 6) ||
                (r < 6 && c >= 9) ||
                (r >= 9 && c < 6) ||
                (r >= 9 && c >= 9);
              const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
              if (inBase || inCenter) return null;

              const info = getTrackCellInfo(r, c);
              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    gridColumn: c + 1,
                    gridRow: r + 1,
                    backgroundColor: info.bg,
                  }}
                  className="border border-slate-300/90 flex items-center justify-center relative select-none"
                >
                  {info.safe && (
                    <Star
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                        info.startColor ? 'text-white fill-white/80' : 'text-amber-500 fill-amber-400'
                      }`}
                    />
                  )}
                </div>
              );
            })
          )}

          {/* Render Tokens Overlay */}
          {allRenderedTokens.map(({ token, coords, isMovable, stackIndex, stackTotal }) => {
            const palette = PLAYER_PALETTE[token.color];
            // Calculate slight offset when multiple tokens share a square
            const angle = (stackIndex / Math.max(1, stackTotal)) * Math.PI * 2;
            const offsetRadius = stackTotal > 1 ? 1.1 : 0;
            const rowOffset = Math.sin(angle) * offsetRadius;
            const colOffset = Math.cos(angle) * offsetRadius;

            const topPercent = ((coords[0] + 0.5) / 15) * 100 + rowOffset;
            const leftPercent = ((coords[1] + 0.5) / 15) * 100 + colOffset;

            return (
              <button
                key={`${token.color}-${token.tokenIndex}`}
                type="button"
                disabled={!isMovable || currentPlayer.type !== 'human'}
                onClick={() =>
                  isMovable &&
                  diceValue !== null &&
                  executeTokenMove(token.tokenIndex, diceValue)
                }
                style={{
                  top: `${topPercent}%`,
                  left: `${leftPercent}%`,
                  backgroundColor: palette.hex,
                  zIndex: isMovable ? 30 : 15 + stackIndex,
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 w-[5.2%] aspect-square rounded-full border-2 border-white shadow-md transition-all duration-150 flex items-center justify-center ${
                  isMovable && currentPlayer.type === 'human'
                    ? 'animate-token-pulse cursor-pointer ring-4 ring-amber-300 scale-115'
                    : 'cursor-default'
                }`}
                title={`${palette.label} Token #${token.tokenIndex + 1}`}
              >
                <span className="w-2/5 h-2/5 rounded-full bg-white/80 pointer-events-none" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Control Sidebar */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        {/* Top Action Bar */}
        <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3">
          <button
            type="button"
            onClick={onBackToHub}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl transition"
          >
            <Home className="w-3.5 h-3.5" />
            Game Hub
          </button>

          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
            <ShieldCheck className="w-4 h-4" />
            Royal Ludo
          </div>

          <button
            type="button"
            onClick={resetGame}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        {/* Current Turn & 3D Dice Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex flex-col items-center text-center shadow-xl">
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Active Turn
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span
              className="w-3.5 h-3.5 rounded-full ring-2 ring-white/40"
              style={{ backgroundColor: PLAYER_PALETTE[currentPlayer.color].hex }}
            />
            <span className="text-lg font-display font-bold text-white">
              {currentPlayer.name}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {currentPlayer.type === 'bot' ? 'AI Bot' : 'Human'}
            </span>
          </div>

          <Dice
            value={diceValue}
            rolling={rolling}
            canRoll={phase === 'ROLL' && currentPlayer.type === 'human'}
            onRoll={handleRollDice}
            activeColor={currentPlayer.color}
            label={
              phase === 'MOVE'
                ? currentPlayer.type === 'human'
                  ? 'Select a glowing token to move!'
                  : `${currentPlayer.name} is choosing a token...`
                : currentPlayer.type === 'bot'
                ? `${currentPlayer.name} is rolling...`
                : undefined
            }
          />
        </div>

        {/* Player Standings */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 flex flex-col gap-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
            Players & Home Tokens
          </h3>
          {activePlayers.map((p, idx) => {
            const palette = PLAYER_PALETTE[p.color];
            const isTurn = idx === turnIndex && phase !== 'GAMEOVER';
            const pTokens = tokensByColor[p.color];
            const homeCount = pTokens.filter((t) => t.progress === 56).length;
            const activeOnTrack = pTokens.filter(
              (t) => t.progress >= 0 && t.progress < 56
            ).length;

            return (
              <div
                key={p.id}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl border transition ${
                  isTurn
                    ? 'bg-slate-800 border-amber-400/70 shadow-md'
                    : 'bg-slate-950/50 border-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full"
                    style={{ backgroundColor: palette.hex }}
                  />
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      {p.name}
                      {p.type === 'bot' ? (
                        <Bot className="w-3.5 h-3.5 text-indigo-400" />
                      ) : (
                        <User className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {activeOnTrack} on board • {homeCount}/4 finished
                    </div>
                  </div>
                </div>

                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((slot) => (
                    <span
                      key={slot}
                      className={`w-3 h-3 rounded-full border ${
                        slot < homeCount
                          ? 'border-white'
                          : 'bg-slate-800 border-slate-700'
                      }`}
                      style={{
                        backgroundColor: slot < homeCount ? palette.hex : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Match Feed */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 flex-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Play-by-Play Log
          </h3>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-xs">
            {logs.map((entry, i) => (
              <div
                key={i}
                className={`px-2.5 py-1.5 rounded-xl ${
                  i === 0
                    ? 'bg-slate-800 text-white font-medium'
                    : 'text-slate-400 bg-slate-950/40'
                }`}
              >
                {entry}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Winner Celebration Modal */}
      {winner && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-400/60 rounded-3xl max-w-md w-full p-8 text-center shadow-2xl animate-float">
            <div className="w-16 h-16 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center mx-auto mb-4">
              <Trophy className="w-9 h-9 text-amber-400" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white mb-1">
              {winner.name} Wins!
            </h2>
            <p className="text-sm text-slate-300 mb-6">
              All 4 {PLAYER_PALETTE[winner.color].label} tokens reached the royal home triangle!
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={resetGame}
                className="px-5 py-2.5 rounded-xl font-bold text-sm bg-amber-400 hover:bg-amber-300 text-slate-950 transition shadow-lg"
              >
                Play Again
              </button>
              <button
                type="button"
                onClick={onBackToHub}
                className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition"
              >
                Back to Hub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
