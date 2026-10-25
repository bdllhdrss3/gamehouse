import React from 'react';
import { Bot, User, Check, Users, Sparkles } from 'lucide-react';
import { PlayerConfig, PLAYER_PALETTE } from '../types';

interface PlayerSetupModalProps {
  players: PlayerConfig[];
  onChange: (players: PlayerConfig[]) => void;
  onQuickPreset: (mode: 'solo-4' | 'solo-2' | 'pass-2' | 'pass-4') => void;
}

export const PlayerSetupPanel: React.FC<PlayerSetupModalProps> = ({
  players,
  onChange,
  onQuickPreset,
}) => {
  const activeCount = players.filter((p) => p.active).length;

  const toggleActive = (id: number) => {
    const target = players.find((p) => p.id === id);
    if (!target) return;
    // Ensure at least 2 active players
    if (target.active && activeCount <= 2) return;

    onChange(
      players.map((p) => (p.id === id ? { ...p, active: !p.active } : p))
    );
  };

  const toggleType = (id: number) => {
    onChange(
      players.map((p) => {
        if (p.id !== id) return p;
        const nextType = p.type === 'human' ? 'bot' : 'human';
        const defaultName =
          nextType === 'bot' ? `Bot ${['Alpha', 'Nova', 'Titan', 'Apex'][p.id]}` : `Player ${p.id + 1}`;
        return {
          ...p,
          type: nextType,
          name: p.name.startsWith('Player ') || p.name.startsWith('Bot ') ? defaultName : p.name,
        };
      })
    );
  };

  const updateName = (id: number, name: string) => {
    onChange(players.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            Player & Bot Lineup
          </h2>
          <p className="text-sm text-slate-400">
            Customize up to 4 seats — mix Human Pass-and-Play with smart AI Bots
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onQuickPreset('solo-2')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            1v1 vs Bot
          </button>
          <button
            type="button"
            onClick={() => onQuickPreset('solo-4')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition flex items-center gap-1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            1 Human vs 3 Bots
          </button>
          <button
            type="button"
            onClick={() => onQuickPreset('pass-2')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            2P Pass & Play
          </button>
          <button
            type="button"
            onClick={() => onQuickPreset('pass-4')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            4P Party Mode
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {players.map((player) => {
          const palette = PLAYER_PALETTE[player.color];
          return (
            <div
              key={player.id}
              className={`relative rounded-2xl p-4 border transition-all ${
                player.active
                  ? 'bg-slate-800/80 border-slate-700 shadow-lg'
                  : 'bg-slate-900/40 border-slate-800/60 opacity-50'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full shadow-sm ring-2 ring-white/20"
                    style={{ backgroundColor: palette.hex }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    {palette.label}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => toggleActive(player.id)}
                  title={
                    player.active && activeCount <= 2
                      ? 'Minimum 2 players required'
                      : player.active
                      ? 'Disable seat'
                      : 'Enable seat'
                  }
                  className={`w-6 h-6 rounded-lg flex items-center justify-center border text-xs transition ${
                    player.active
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-500'
                  }`}
                >
                  {player.active && <Check className="w-3.5 h-3.5" />}
                </button>
              </div>

              <input
                type="text"
                disabled={!player.active}
                value={player.name}
                maxLength={16}
                onChange={(e) => updateName(player.id, e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-700/80 text-sm font-semibold text-white focus:outline-none focus:border-amber-400 mb-3"
              />

              <div className="grid grid-cols-2 gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  disabled={!player.active}
                  onClick={() => player.type !== 'human' && toggleType(player.id)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                    player.type === 'human'
                      ? 'bg-slate-800 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  Human
                </button>
                <button
                  type="button"
                  disabled={!player.active}
                  onClick={() => player.type !== 'bot' && toggleType(player.id)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                    player.type === 'bot'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  AI Bot
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
