import { useEffect, useRef, useState } from 'react';
import type { Game } from '../../shared/game';
import { audio } from './audio';

export function usePresentation(game: Game, reduced: boolean, haptics: boolean) {
  const [shown, setShown] = useState(game);
  const [busy, setBusy] = useState(false);
  const last = useRef(game);
  useEffect(() => {
    const previous = last.current;
    last.current = game;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, delay: number) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, delay));
    const sequential = previous.id === game.id && previous.revision + 1 === game.revision;
    if (!sequential || document.hidden) {
      setShown(game); setBusy(false);
      return;
    }
    if (haptics && navigator.vibrate) navigator.vibrate(18);
    let time = 0;
    setBusy(true);
    setShown({ ...game, positions: previous.positions.map(p => [...p]) });
    for (const event of game.events) {
      later(() => audio.play(event.type), time);
      if (event.path && event.token !== undefined) {
        for (const pos of event.path.slice(1)) {
          time += reduced ? 0 : event.type === 'move' ? 85 : 280;
          later(() => setShown(g => ({
            ...g, positions: g.positions.map((p, i) => i === event.player ? p.map((value, t) => t === event.token ? pos : value) : p),
          })), time);
        }
      } else if (event.type === 'roll' && !reduced) time += 300;
    }
    later(() => { setShown(game); setBusy(false); }, time + (reduced ? 0 : 80));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [game, reduced, haptics]);
  return { shown, busy };
}
