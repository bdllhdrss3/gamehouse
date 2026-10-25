import React from 'react';
import { PlayerColor, PLAYER_PALETTE } from '../types';

interface DiceProps {
  value: number | null;
  rolling: boolean;
  canRoll: boolean;
  onRoll: () => void;
  activeColor: PlayerColor;
  label?: string;
}

// Pip positions on a 3x3 grid (indices 0..8)
const PIP_MAP: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export const Dice: React.FC<DiceProps> = ({
  value,
  rolling,
  canRoll,
  onRoll,
  activeColor,
  label,
}) => {
  const palette = PLAYER_PALETTE[activeColor];
  const displayFace = value ?? 6;
  const pips = PIP_MAP[displayFace] || PIP_MAP[6];

  return (
    <div className="flex flex-col items-center gap-2.5">
      <button
        type="button"
        disabled={!canRoll || rolling}
        onClick={onRoll}
        aria-label="Roll Dice"
        className={`group relative flex items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 select-none ${
          rolling ? 'animate-dice-shake' : ''
        } ${
          canRoll && !rolling
            ? 'cursor-pointer hover:scale-105 active:scale-95 shadow-xl'
            : 'cursor-not-allowed opacity-75'
        }`}
        style={{
          background: 'linear-gradient(145deg, #ffffff 0%, #e2e8f0 100%)',
          boxShadow: canRoll
            ? `0 10px 25px -5px ${palette.hex}66, 0 0 0 3px ${palette.hex}, inset 0 -4px 6px rgba(0,0,0,0.18)`
            : '0 4px 12px rgba(0,0,0,0.3), inset 0 -4px 6px rgba(0,0,0,0.18)',
        }}
      >
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-14 h-14 p-1.5">
          {Array.from({ length: 9 }).map((_, idx) => {
            const hasPip = pips.includes(idx);
            return (
              <div key={idx} className="flex items-center justify-center">
                {hasPip && (
                  <span
                    className="w-3 h-3 rounded-full transition-transform duration-150"
                    style={{
                      backgroundColor:
                        displayFace === 6 || displayFace === 1 ? palette.hex : '#0f172a',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.45)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {canRoll && !rolling && (
          <span
            className="absolute -top-2 -right-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full text-slate-950 shadow-md animate-bounce"
            style={{ backgroundColor: '#fbbf24' }}
          >
            Roll
          </span>
        )}
      </button>

      <div className="text-xs font-medium text-slate-300 h-4 flex items-center gap-1.5">
        {rolling ? (
          <span className="text-amber-300 font-semibold animate-pulse">Rolling dice...</span>
        ) : label ? (
          <span>{label}</span>
        ) : value ? (
          <span>
            Rolled a <strong className="text-white font-bold">{value}</strong>
          </span>
        ) : (
          <span className="text-slate-400">Click or press Space</span>
        )}
      </div>
    </div>
  );
};
