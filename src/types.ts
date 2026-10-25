export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export type PlayerType = 'human' | 'bot';

export interface PlayerConfig {
  id: number;
  name: string;
  color: PlayerColor;
  type: PlayerType;
  active: boolean;
}

export type GameMode = 'hub' | 'ludo' | 'snakes';

export const PLAYER_PALETTE: Record<
  PlayerColor,
  {
    label: string;
    hex: string;
    lightHex: string;
    darkHex: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
    ringClass: string;
    badgeBg: string;
  }
> = {
  red: {
    label: 'Ruby Red',
    hex: '#ef4444',
    lightHex: '#fee2e2',
    darkHex: '#991b1b',
    bgClass: 'bg-red-500',
    borderClass: 'border-red-400',
    textClass: 'text-red-400',
    ringClass: 'ring-red-400',
    badgeBg: 'bg-red-500/20 border-red-500/40 text-red-300',
  },
  green: {
    label: 'Emerald Green',
    hex: '#22c55e',
    lightHex: '#dcfce7',
    darkHex: '#166534',
    bgClass: 'bg-green-500',
    borderClass: 'border-green-400',
    textClass: 'text-green-400',
    ringClass: 'ring-green-400',
    badgeBg: 'bg-green-500/20 border-green-500/40 text-green-300',
  },
  yellow: {
    label: 'Solar Gold',
    hex: '#eab308',
    lightHex: '#fef9c3',
    darkHex: '#854d0e',
    bgClass: 'bg-amber-400',
    borderClass: 'border-amber-300',
    textClass: 'text-amber-300',
    ringClass: 'ring-amber-300',
    badgeBg: 'bg-amber-500/20 border-amber-500/40 text-amber-200',
  },
  blue: {
    label: 'Sapphire Blue',
    hex: '#3b82f6',
    lightHex: '#dbeafe',
    darkHex: '#1e40af',
    bgClass: 'bg-blue-500',
    borderClass: 'border-blue-400',
    textClass: 'text-blue-400',
    ringClass: 'ring-blue-400',
    badgeBg: 'bg-blue-500/20 border-blue-500/40 text-blue-300',
  },
};

export const DEFAULT_PLAYERS: PlayerConfig[] = [
  { id: 0, name: 'Player 1', color: 'red', type: 'human', active: true },
  { id: 1, name: 'Bot Alpha', color: 'green', type: 'bot', active: true },
  { id: 2, name: 'Bot Nova', color: 'yellow', type: 'bot', active: true },
  { id: 3, name: 'Bot Titan', color: 'blue', type: 'bot', active: true },
];
