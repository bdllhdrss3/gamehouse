import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Dice5, Home, Link, Moon, Plus, RotateCcw, Settings, Share2, ShieldCheck, Shuffle, Sparkles, Sun, Trophy, Users, Volume2, VolumeX, Wifi, WifiOff, X, Zap } from 'lucide-react';
import { z } from 'zod';
import { avatarInfo, avatarSchema, boardVariants, botToken, chessPieceInfo, chessPieceSchema, createGame, gameSchema, getBoard, legalMoves, localPlayers, reachable, names, suggestedName, transition, type Action, type AvatarId, type ChessPieceId, type Game, type Player, type Preset } from '../shared/game';
import type { Room } from '../shared/protocol';
import { Avatar, AvatarPicker, ChessPiecePicker } from './components/Avatar';
import { boardThemeIds, boardThemeSchema, boardThemes, lighten, type BoardThemeId } from './components/themes';
import { boardColors } from './components/LudoArt';
import GameBoard, { LudoBoard, PlayerMark, SnakesBoard } from './components/Boards';
import { audio } from './lib/audio';
import { readStorage, writeStorage } from './lib/storage';
import { usePresentation } from './lib/presentation';
import { newId } from './lib/id';
import type { RoomCommand, RoomConnection } from './lib/rooms';

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(20), avatar: avatarSchema,
  piece: chessPieceSchema.default('king'),
  theme: z.enum(['system', 'light', 'dark']), muted: z.boolean(),
  volume: z.number().min(0).max(1), reduced: z.boolean(), haptics: z.boolean(),
  boardTheme: boardThemeSchema.default('meadow'),
});
type SettingsValue = z.infer<typeof settingsSchema>;
type View = 'home' | 'setup' | 'join' | 'room' | 'local';
const profileKey = 'little-table-settings-v1';
const localKey = 'little-table-match-v1';
function initialSettings(): SettingsValue {
  const defaults: SettingsValue = { name: '', avatar: 'bunny', piece: 'king', theme: 'system', muted: false, volume: .45, reduced: false, haptics: false, boardTheme: 'meadow' };
  const raw = readStorage(profileKey);
  if (!raw) return defaults;
  try { return settingsSchema.parse(JSON.parse(raw)); }
  catch (error) {
    console.error('Invalid saved settings.', error);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('storage-error', { detail: 'Your saved profile could not be read. Choose your name and avatar again.' })), 0);
    return defaults;
  }
}
function loadGame(): { game: Game | null; error: string } {
  const raw = readStorage(localKey);
  if (!raw) return { game: null, error: '' };
  try { return { game: gameSchema.parse(JSON.parse(raw)), error: '' }; }
  catch (error) {
    console.error('Invalid local match.', error);
    return { game: null, error: 'Your saved match is incompatible or damaged. Start a new game to replace it.' };
  }
}
function roll(): number {
  const data = new Uint32Array(1);
  do { crypto.getRandomValues(data); } while (data[0] >= 4294967292);
  return data[0] % 6 + 1;
}
function ErrorMessage({ text, dismiss }: { text: string; dismiss?: () => void }) {
  return text ? <div role="alert" className="error-message"><span>{text}</span>{dismiss && <button className="icon-button" aria-label="Dismiss message" onClick={dismiss}><X size={17} /></button>}</div> : null;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="dialog-title" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="modal-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>{children}
  </dialog>;
}

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [view, setView] = useState<View>(() => new URLSearchParams(location.search).has('room') ? 'join' : 'home');
  const [preset, setPreset] = useState<Preset>('ludo');
  const [boardSeed, setBoardSeed] = useState(0);
  const [mode, setMode] = useState<'solo' | 'local' | 'friends'>('solo');
  const [count, setCount] = useState(2);
  const [seats, setSeats] = useState<Player[]>(() => localPlayers(2, false, settings.name, settings.avatar, settings.piece));
  const [saved] = useState(loadGame);
  const [localGame, setLocalGame] = useState<Game | null>(saved.game);
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [you, setYou] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(saved.error);
  const [storageWarning, setStorageWarning] = useState('');
  const [pending, setPending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => void } | null>(null);
  const [invitation, setInvitation] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [systemReduced, setSystemReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const connection = useRef<RoomConnection | null>(null);
  const reduced = settings.reduced || systemReduced;

  useEffect(() => {
    const storageError = (event: Event) => setStorageWarning((event as CustomEvent<string>).detail);
    window.addEventListener('storage-error', storageError);
    return () => window.removeEventListener('storage-error', storageError);
  }, []);
  useEffect(() => {
    if (settingsSchema.safeParse(settings).success) {
      writeStorage(profileKey, JSON.stringify(settings));
      setLocalGame(g => {
        if (!g) return g;
        const first = g.players[0];
        if (!first || first.bot) return g;
        const nextName = settings.name.trim();
        if (!nextName) return g;
        if (g.players.some((p, idx) => idx > 0 && p.name.toLowerCase() === nextName.toLowerCase())) return g;
        if (first.name === nextName && first.avatar === settings.avatar && first.piece === settings.piece) return g;
        return {
          ...g,
          players: g.players.map((p, idx) => idx === 0 ? { ...p, name: nextName, avatar: settings.avatar, piece: settings.piece } : p),
        };
      });
    }
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    audio.muted = settings.muted; audio.volume = settings.volume;
    audio.onError = setError;
    if (settings.muted) audio.quiet();
  }, [settings, reduced]);
  useEffect(() => {
    if (localGame) writeStorage(localKey, JSON.stringify(localGame));
  }, [localGame]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(media.matches);
    media.addEventListener('change', change);
    const hidden = () => { if (document.hidden) audio.quiet(); };
    document.addEventListener('visibilitychange', hidden);
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener('online', online); window.addEventListener('offline', online);
    return () => { media.removeEventListener('change', change); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('online', online); window.removeEventListener('offline', online); connection.current?.close(); };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let mounted = true;
    navigator.serviceWorker.register('/sw.js').then(async reg => {
      await navigator.serviceWorker.ready;
      if (!mounted) return;
      setOfflineReady(true);
      if (reg.waiting) setUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && mounted) setUpdate(worker);
        });
      });
    }).catch(error => {
      console.error('Offline setup failed.', error);
      if (mounted) setStorageWarning('Offline setup could not finish. You can still play while connected.');
    });
    return () => { mounted = false; };
  }, []);

  const acceptRoom = useCallback((next: Room) => {
    if (roomRef.current?.id === next.id && roomRef.current.revision > next.revision) return;
    roomRef.current = next;
    setRoom(next);
  }, []);
  async function getConnection() {
    if (!connection.current) {
      const { RoomConnection } = await import('./lib/rooms');
      const c = new RoomConnection();
      c.onRoom = acceptRoom; c.onStatus = setConnected; c.onError = setError;
      connection.current = c;
      try { await c.connect(); }
      catch (error) { c.close(); connection.current = null; throw error; }
      setYou(c.you);
    }
    return connection.current;
  }
  async function task(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError('');
    try { await fn(); }
    catch (error) { console.error('Player action failed.', error); setError(error instanceof Error ? error.message : 'That action could not finish. Please try again.'); }
    finally { setPending(false); }
  }
  const profile = { name: settings.name.trim(), avatar: settings.avatar, piece: settings.piece };
  const validName = profile.name.length > 0 && profile.name.length <= 20;
  async function enterRoom(join: boolean) {
    await task(async () => {
      if (!validName) throw new Error('Give yourself a nickname first.');
      const c = await getConnection();
      const next = join ? await c.join(invitation.trim(), profile) : await c.create(preset, profile, boardSeed);
      acceptRoom(next); setYou(c.you); setView('room');
      history.replaceState(null, '', `?room=${encodeURIComponent(next.invite)}`);
    });
  }
  const command = (value: RoomCommand) => task(async () => {
    if (!roomRef.current || !connection.current) throw new Error('Open your room again to reconnect.');
    void audio.unlock();
    await connection.current.command(roomRef.current, value);
  });
  function saveSettings() {
    if (!validName) return;
    if (view === 'room' && connected && roomRef.current && connection.current) {
      void command({ type: 'profile', name: profile.name, avatar: profile.avatar, piece: profile.piece });
    }
    setShowSettings(false);
  }
  function home() {
    connection.current?.close(); connection.current = null;
    roomRef.current = null; setRoom(null); setView('home'); setError('');
    history.replaceState(null, '', location.pathname);
  }
  function leave() {
    if (view === 'room') {
      setConfirm({ title: 'Leave this table?', text: 'Your friends can continue. The host can replace your seat with a bot. Keep your invite link to return.', action: () => {
        void task(async () => {
          if (connected && connection.current && roomRef.current) await connection.current.command(roomRef.current, { type: 'leave' });
          home(); setConfirm(null);
        });
      } });
    } else { home(); }
  }
  function prepare(value: Preset) {
    setPreset(value); setMode('solo'); setCount(2);
    setSeats(localPlayers(2, false, settings.name, settings.avatar, settings.piece)); setView('setup'); setError('');
  }
  function startLocal() {
    if (!validName) { setError('Give yourself a nickname first.'); return; }
    const players = mode === 'solo' ? localPlayers(count, true, profile.name, settings.avatar, settings.piece) :
      seats.map((p, i) => ({ ...p, name: i === 0 ? profile.name : p.name.trim(), avatar: i === 0 ? settings.avatar : p.avatar, piece: i === 0 ? settings.piece : p.piece }));
    if (players.some(p => !p.name)) { setError('Every player needs a nickname.'); return; }
    if (new Set(players.map(p => p.name.toLowerCase())).size !== players.length) { setError('Choose a different nickname for each seat so everyone knows whose turn it is.'); return; }
    setLocalGame(createGame(preset, players, newId(), boardSeed)); setView('local'); setError('');
    void audio.unlock();
  }
  function localAction(type: 'roll' | 'move', token = 0) {
    void audio.unlock();
    const action: Action = type === 'roll' ? { type, value: roll() } : { type, token };
    setLocalGame(g => {
      if (!g) return g;
      return transition(g, action);
    });
  }
  async function copyInvite(share = false) {
    if (!room) return;
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.invite)}`;
    await task(async () => {
      if (share && navigator.share) {
        try { await navigator.share({ title: 'Join my Little Table', text: 'A little board-game break?', url }); }
        catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setError(''); setCopied(true); setTimeout(() => setCopied(false), 2500);
      } else throw new Error('Clipboard is unavailable. Select and copy the invite link shown below.');
    });
  }
  const [copied, setCopied] = useState(false);
  const activeGame = view === 'local' ? localGame : view === 'room' ? room?.game : null;
  const updateAllowed = !activeGame || activeGame.phase === 'finished';
  const profileEditor = (id: string) => <div className="profile-editor">
    {id === 'nickname' && <h2 className="name-prompt">What should we call you?</h2>}
    <div className="field"><label htmlFor={id}>Your nickname</label><div className="input-with-button">
      <input id={id} autoFocus={id === 'nickname'} autoComplete="nickname" maxLength={20} required placeholder="Your name or nickname" value={settings.name} onChange={e => setSettings(s => ({ ...s, name: e.target.value }))} onFocus={e => e.currentTarget.select()} aria-describedby={`${id}-help`} aria-invalid={settings.name.length > 0 && !validName} />
      {settings.name && <button type="button" className="icon-button" aria-label="Clear nickname" title="Clear name" onClick={() => { setSettings(s => ({ ...s, name: '' })); document.getElementById(id)?.focus(); }}><X size={17} /></button>}
      <button type="button" className="icon-button" aria-label="Suggest a new nickname" title="Shuffle nickname" onClick={() => setSettings(s => ({ ...s, name: suggestedName() }))}><Shuffle size={19} /></button>
    </div><small id={`${id}-help`}>{validName ? 'This is the name everyone at the table will see.' : 'Choose a name with 1-20 characters, or shuffle for a nickname.'}</small></div>
    <AvatarPicker value={settings.avatar} onChange={avatar => setSettings(s => ({ ...s, avatar }))} />
    <ChessPiecePicker value={settings.piece} onChange={piece => setSettings(s => ({ ...s, piece }))} />
  </div>;

  const themePicker = <fieldset><legend>Board theme</legend><div className="theme-picker">{boardThemeIds.map(id => {
    const t = boardThemes[id];
    return <button key={id} type="button" aria-pressed={settings.boardTheme === id} className={settings.boardTheme === id ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, boardTheme: id }))}>
      <span className="theme-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${t.frame[0]}, ${t.frame[2]})` }}>{t.tiles.slice(0, 4).map(c => <i key={c} style={{ background: lighten(c, t.lift / 2) }} />)}</span>
      <strong>{t.label}</strong><small>{t.blurb}</small>
    </button>;
  })}</div></fieldset>;

  return <div className="app-shell">
    <header className="site-header">
      <button className="brand" onClick={view === 'home' ? () => {} : leave} aria-label="littletable. home"><span className="brand-mark"><Dice5 size={25} strokeWidth={2.3} /></span><span>little<span className="brand-table">table</span><span className="brand-dot">.</span></span></button>
      <div className="header-actions">
        <span className="header-note">{offline ? <><WifiOff size={14} /> Offline</> : <><span className="tiny-spark">✦</span> A little play goes a long way</>}</span>
        <button className="icon-button" aria-label={settings.muted ? 'Turn sound on' : 'Mute sound'} onClick={() => { audio.muted = !settings.muted; setSettings(s => ({ ...s, muted: !s.muted })); if (settings.muted) void audio.unlock(); }}>{settings.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
        <button className="icon-button" aria-label="Open settings" onClick={() => setShowSettings(true)}><Settings size={20} /></button>
        <button className="header-avatar" aria-label="Edit your nickname and avatar" onClick={() => setShowSettings(true)}>
          <Avatar id={settings.avatar} small />
          <span className="header-name">{settings.name || 'Set name'}</span>
        </button>
      </div>
    </header>
    <main>
      <ErrorMessage text={storageWarning} dismiss={() => setStorageWarning('')} />
      <ErrorMessage text={error} dismiss={() => setError('')} />
      {update && <div className="notice">A fresh version is ready. {updateAllowed ? <button onClick={() => { update.postMessage({ type: 'ACTIVATE' }); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); }}>Refresh app</button> : 'Finish this match before refreshing.'}</div>}
      {view === 'home' && <>
        <section className="welcome">
          <div className="welcome-copy"><span className="eyebrow"><span /> SMALL GAMES. GOOD COMPANY.</span>
            <h1>Gather around.<br />Let the good <span className="play-word">times roll<svg viewBox="0 0 260 14" aria-hidden="true"><path d="M3 9 Q130 -3 257 7" /></svg></span>.</h1>
            <p>Your favorite board games, with a little extra joy.<br className="desktop-break" /> Play solo, share a screen, or bring your friends.</p>
          </div>
          <div className="welcome-sticker" aria-hidden="true"><span className="sticker-star">✦</span><div className="sticker-dice"><Dice5 size={76} strokeWidth={1.4} /></div><span className="sticker-text">Your next<br />happy little break.</span><span className="sticker-dot" /></div>
        </section>
        <section aria-label="Choose a game" className="game-choices">
          <button className="game-choice ludo-choice" onClick={() => prepare('ludo')}>
            <div className="choice-art"><span className="art-spark one">✧</span><div className="preview-board"><LudoBoard preview theme={settings.boardTheme} /></div><span className="art-spark two">✦</span><span className="art-piece piece-red" /><span className="art-piece piece-yellow" /></div>
            <div className="choice-info"><div><span className="game-kind">THE FRIENDLY RIVALRY</span><h2>Ludo</h2><p>Four little pieces. One big race home.</p><span className="game-meta"><Users size={14} /> 2-4 players <span className="meta-divider" /> Solo or with friends</span></div><span className="round-arrow"><ArrowRight size={24} /></span></div>
          </button>
          <button className="game-choice snakes-choice" onClick={() => prepare('classic')}>
            <div className="choice-art"><span className="art-spark one">✧</span><div className="preview-board"><SnakesBoard preview turbo theme={settings.boardTheme} /></div><span className="art-spark two">✦</span><span className="art-piece piece-green" /><span className="mini-label"><Zap size={14} /> Classic + Turbo</span></div>
            <div className="choice-info"><div><span className="game-kind">A LITTLE LUCK. A LOT OF LAUGHS.</span><h2>Snakes & Ladders</h2><p>Climb a little. Slide a little. Smile a lot.</p><span className="game-meta"><Users size={14} /> 2-4 players <span className="meta-divider" /> Two ways to climb</span></div><span className="round-arrow"><ArrowRight size={24} /></span></div>
          </button>
        </section>
        <section className="join-strip"><span className="join-icon"><Link size={23} /></span><div><h3>Got a seat at a friend's table?</h3><p>Hop in with their room code or invite link.</p></div><button className="button secondary" onClick={() => { setView('join'); setError(''); }}>Join a room <ArrowRight size={17} /></button></section>
        {localGame && localGame.phase !== 'finished' && <button className="resume-link" onClick={() => setView('local')}><RotateCcw size={16} /> Pick up your {names[localGame.preset]} game <ArrowRight size={16} /></button>}
        <div className="home-promises"><span><ShieldCheck size={17} /> No sign-ups. Just play.</span><span><Users size={17} /> Friends near or far.</span><span><Sparkles size={17} /> Light on your phone.</span></div>
      </>}
      {(view === 'setup' || view === 'join') && <section className="setup-page">
        <button className="back-link" onClick={home}><ArrowLeft size={17} /> All games</button>
        <div className="setup-layout"><div className="setup-intro"><span className="soft-label">{view === 'join' ? 'THERE IS A SEAT FOR YOU' : 'MAKE YOURSELF AT HOME'}</span><h1>{view === 'join' ? 'Better together.' : names[preset]}</h1><p>{view === 'join' ? 'A code, a nickname, and you are in.' : preset === 'ludo' ? 'A friendly race around the board. Who will get all four pieces home first?' : 'A lucky roll, a lovely climb. Watch out for those friendly little snakes.'}</p>
          <div className="setup-board">{preset === 'ludo' && view !== 'join' ? <LudoBoard preview theme={settings.boardTheme} /> : <SnakesBoard preview turbo={preset === 'turbo'} boardSeed={boardSeed} theme={settings.boardTheme} />}</div>
          <button className="text-button" onClick={() => setShowRules(true)}>How to play <ChevronDown size={15} /></button>
        </div>
        <div className="setup-panel">
          {profileEditor('nickname')}
          {view === 'join' ? <form onSubmit={e => { e.preventDefault(); void enterRoom(true); }}>
            <div className="field"><label htmlFor="room-code">Room code or invite link</label><input id="room-code" value={invitation} onChange={e => { const input = e.target.value; try { setInvitation(new URL(input).searchParams.get('room') ?? input); } catch { setInvitation(input); } }} maxLength={300} placeholder="e.g. ABCD23" required /><small>Ask your friend to share their table with you.</small></div>
            <button className="button primary full" disabled={pending || offline || !validName || !invitation.trim()}>{pending ? 'Finding your table...' : 'Join the table'} <ArrowRight size={18} /></button>
            {offline && <p className="helper">Friend rooms need an internet connection.</p>}
          </form> : <>
            {themePicker}
            {preset !== 'ludo' && <fieldset><legend>Choose your climb</legend>
              <div className="segmented"><button aria-pressed={preset === 'classic'} className={preset === 'classic' ? 'active' : ''} onClick={() => setPreset('classic')}>Classic <small>100 squares</small></button><button aria-pressed={preset === 'turbo'} className={preset === 'turbo' ? 'active' : ''} onClick={() => setPreset('turbo')}><Zap size={15} /> Turbo <small>64 squares</small></button></div>
              <div className="board-shuffler">
                <span>Board map: <strong>{getBoard(preset, boardSeed).title}</strong> (#{boardSeed % boardVariants[preset].length + 1}/{boardVariants[preset].length})</span>
                <button type="button" className="button small secondary" onClick={() => setBoardSeed(s => s + 1)}><Shuffle size={15} /> Shuffle board</button>
              </div>
            </fieldset>}
            <fieldset><legend>Who is joining?</legend><div className="mode-picker">{([
              ['solo', 'Solo', 'You + friendly bots'], ['local', 'Same device', 'Pass it around'], ['friends', 'Friends', 'Share a private link'],
            ] as const).map(([value, title, subtitle]) => <button key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setError(''); }}><span>{value === 'solo' ? <Sparkles size={19} /> : value === 'local' ? <Home size={19} /> : <Link size={19} />}</span><strong>{title}</strong><small>{subtitle}</small>{mode === value && <Check size={14} className="mode-check" />}</button>)}</div></fieldset>
            {mode !== 'friends' && <fieldset className="seat-count"><legend>Seats at your table</legend><div className="segmented compact">{[2,3,4].map(n => <button key={n} className={count === n ? 'active' : ''} aria-pressed={count === n} onClick={() => { setCount(n); setSeats(localPlayers(n, false, settings.name, settings.avatar, settings.piece)); }}>{n} players</button>)}</div></fieldset>}
            {mode === 'local' && <div className="local-seats">{seats.slice(1).map((p, j) => <div className="local-seat" key={p.id}><label htmlFor={`seat-${p.id}`}>Player {j + 2}</label><input id={`seat-${p.id}`} value={p.name} maxLength={20} onChange={e => setSeats(s => s.map(q => q.id === p.id ? { ...q, name: e.target.value } : q))} /><select aria-label={`Player ${j + 2} avatar`} value={p.avatar} onChange={e => setSeats(s => s.map(q => q.id === p.id ? { ...q, avatar: avatarSchema.parse(e.target.value) } : q))}>{Object.entries(avatarInfo).map(([id, info]) => <option key={id} value={id}>{info.face} {info.label}</option>)}</select><select aria-label={`Player ${j + 2} piece`} value={p.piece} onChange={e => setSeats(s => s.map(q => q.id === p.id ? { ...q, piece: chessPieceSchema.parse(e.target.value) } : q))}>{Object.entries(chessPieceInfo).map(([id, info]) => <option key={id} value={id}>{info.glyph} {info.label}</option>)}</select><label className="seat-bot"><input type="checkbox" checked={p.bot} onChange={e => setSeats(s => s.map(q => q.id === p.id ? { ...q, bot: e.target.checked } : q))} /> Let a friendly bot play this seat</label></div>)}</div>}
            <button className="button primary full" disabled={pending || !validName || (mode === 'friends' && offline)} onClick={() => mode === 'friends' ? void enterRoom(false) : localGame && localGame.phase !== 'finished' ? setConfirm({ title: 'Start a fresh game?', text: 'This replaces your saved local game.', action: () => { setConfirm(null); startLocal(); } }) : startLocal()}>{pending ? 'Setting your table...' : mode === 'friends' ? 'Create a room' : 'Let’s play'} <ArrowRight size={18} /></button>
            <p className="panel-footnote">{mode === 'friends' ? 'Private by invitation. No account needed.' : mode === 'solo' ? 'Your bots play fair. The dice decide.' : 'One screen, good company. Everyone gets a turn.'}</p>
          </>}
        </div></div>
      </section>}
      {view === 'local' && localGame && <Match game={localGame} boardTheme={settings.boardTheme} reduced={reduced} haptics={settings.haptics} canAct={!localGame.players[localGame.turn].bot} online={false} pending={false} onAction={localAction}
        onBot={() => localAction(localGame.phase === 'move' ? 'move' : 'roll', localGame.phase === 'move' ? botToken(localGame) : 0)}
        onBack={home} onRules={() => setShowRules(true)} onShuffle={localGame.preset !== 'ludo' ? () => setLocalGame(createGame(localGame.preset, localGame.players, newId(), localGame.boardSeed + 1)) : undefined}
        onRematch={() => setLocalGame(createGame(localGame.preset, localGame.players, newId(), localGame.boardSeed))} />}
      {view === 'room' && room && <>
        <div className="room-top"><button className="back-link" onClick={leave}><ArrowLeft size={17} /> Leave table</button><span className={`connection-state ${connected ? '' : 'disconnected'}`}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}{connected ? `Room ${room.code}` : 'Reconnecting. Your seat is saved.'}</span></div>
        {room.status === 'lobby' ? <section className="lobby">
          <div className="lobby-heading"><span className="soft-label">YOUR PRIVATE LITTLE TABLE</span><h1>{names[room.preset]}</h1><p>Send an invite. Settle in. Start when everyone is ready.</p></div>
          <div className="lobby-layout"><div className="lobby-seats">{room.seats.map(p => <div className="lobby-seat" key={p.id}><Avatar id={p.avatar} /><div><strong>{p.name} {p.id === you && <span className="you-tag">you</span>}</strong><small>{p.bot ? 'Friendly bot' : !p.online ? 'Away from the table' : p.id === room.host ? 'Host' : 'At the table'} · {chessPieceInfo[p.piece].glyph} {chessPieceInfo[p.piece].label}</small></div>{p.id === you && <button type="button" className="text-button edit-seat-btn" onClick={() => setShowSettings(true)}>Edit profile</button>}<span className={`ready-tag ${p.ready || p.bot ? 'is-ready' : ''}`}>{p.ready || p.bot ? <><Check size={14} /> Ready</> : 'Settling in'}</span></div>)}
            {room.preset !== 'ludo' && <div className="board-shuffler">
              <span>Board map: <strong>{getBoard(room.preset, room.boardSeed).title}</strong> (#{room.boardSeed % boardVariants[room.preset].length + 1}/{boardVariants[room.preset].length})</span>
              {room.host === you && <button type="button" className="button small secondary" disabled={pending || !connected} onClick={() => void command({ type: 'shuffle' })}><Shuffle size={15} /> Shuffle board</button>}
            </div>}
            {room.seats.length < 4 && <div className="empty-seat"><Plus size={22} /><span>A seat for someone lovely</span>{room.host === you && <button className="text-button" disabled={pending || !connected} onClick={() => void command({ type: 'bot', add: true })}>Add a bot</button>}</div>}
            {room.host === you && room.seats.some(p => p.bot) && <button className="text-button" disabled={pending || !connected} onClick={() => void command({ type: 'bot', add: false })}>Remove a bot</button>}
            <button className="button secondary full" disabled={pending || !connected} onClick={() => void command({ type: 'ready', ready: !room.seats.find(p => p.id === you)?.ready })}>{room.seats.find(p => p.id === you)?.ready ? 'Not ready yet' : 'I’m ready'} <Check size={18} /></button>
            {room.host === you && <button className="button primary full" disabled={pending || !connected || room.seats.length < 2 || room.seats.some(p => !p.bot && (!p.ready || !p.online))} onClick={() => void command({ type: 'start' })}>Start the fun <ArrowRight size={18} /></button>}
          </div><div className="invite-panel"><span className="invite-illustration"><Link size={38} /></span><h2>Good games need good company.</h2><p>Share this link, or send your room code.</p><div className="room-code">{room.code}</div><label className="sr-only" htmlFor="invite-url">Your invite link</label><input id="invite-url" readOnly value={`${location.origin}${location.pathname}?room=${room.invite}`} onFocus={e => e.target.select()} />
            <div className="button-row"><button className="button primary" disabled={pending} onClick={() => void copyInvite()}><Copy size={17} /> {copied ? 'Copied!' : 'Copy invite'}</button><button className="button secondary" disabled={pending} onClick={() => void copyInvite(true)}><Share2 size={17} /> Share</button></div><small>Keep this link to find your way back.</small>
          </div></div>
        </section> : room.game && <><Match game={room.game} boardTheme={settings.boardTheme} reduced={reduced} haptics={settings.haptics} canAct={connected && room.game.players[room.game.turn].id === you} online pending={pending}
          onAction={(type, token) => void command(type === 'roll' ? { type } : { type, token: token ?? 0 })}
          onBack={leave} onRules={() => setShowRules(true)} onRematch={() => void command({ type: 'lobby' })} rematchAllowed={room.host === you && connected} />
          {room.seats.filter(p => !p.bot && !p.online).map(p => <div className="notice" key={p.id}>{p.name} is away. Their seat is saved.{room.host === you && <button disabled={pending || !connected} onClick={() => setConfirm({ title: `Let a bot play for ${p.name}?`, text: 'Available after 15 seconds away. Their seat will become a bot seat for this match. They cannot silently take it back.', action: () => { setConfirm(null); void command({ type: 'replace', seat: p.id }); } })}>Replace with a bot</button>}</div>)}
        </>}
      </>}
    </main>
    <footer className="site-footer"><span>Made for little breaks & good company.</span><span>{offlineReady ? <><Check size={13} /> Solo & local ready offline</> : 'No downloads. No fuss.'}</span></footer>
    {showSettings && <Modal title="Your little corner" close={() => setShowSettings(false)}>
      {profileEditor('settings-nickname')}
      <p className="helper">Changes update your nickname, avatar, and chess piece right away.</p>
      {themePicker}
      <fieldset><legend>Make yourself comfortable</legend><div className="segmented">{(['system','light','dark'] as const).map(theme => <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, theme }))}>{theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}{theme}</button>)}</div></fieldset>
      <label className="toggle-row"><span>Sound effects</span><input type="checkbox" checked={!settings.muted} onChange={e => { audio.muted = !e.target.checked; setSettings(s => ({ ...s, muted: !e.target.checked })); if (e.target.checked) void audio.unlock(); }} /></label>
      <label className="volume-row">Effects volume<input type="range" min="0" max="1" step=".05" value={settings.volume} onChange={e => setSettings(s => ({ ...s, volume: Number(e.target.value) }))} /></label>
      <label className="toggle-row"><span>Less motion<small>Your device's preference is always respected.</small></span><input type="checkbox" checked={settings.reduced} onChange={e => setSettings(s => ({ ...s, reduced: e.target.checked }))} /></label>
      {'vibrate' in navigator && <label className="toggle-row"><span>Gentle vibration<small>On supported devices.</small></span><input type="checkbox" checked={settings.haptics} onChange={e => setSettings(s => ({ ...s, haptics: e.target.checked }))} /></label>}
      <button className="button primary full" disabled={!validName} onClick={saveSettings}>All set <Check size={17} /></button>
    </Modal>}
    {showRules && <Modal title={`How to play ${names[activeGame?.preset ?? preset]}`} close={() => setShowRules(false)}><Rules preset={activeGame?.preset ?? preset} /><button className="button primary full" onClick={() => setShowRules(false)}>Got it</button></Modal>}
    {confirm && <Modal title={confirm.title} close={() => setConfirm(null)}><p className="dialog-copy">{confirm.text}</p><div className="button-row"><button className="button secondary" onClick={() => setConfirm(null)}>Stay here</button><button className="button primary" disabled={pending} onClick={confirm.action}>Continue</button></div></Modal>}
    {pending && <span className="sr-only" role="status">Working on it.</span>}
  </div>;
}

function Match({ game, boardTheme, reduced, haptics, canAct, online, pending, onAction, onBot, onBack, onRules, onShuffle, onRematch, rematchAllowed = true }: {
  game: Game; boardTheme: BoardThemeId; reduced: boolean; haptics: boolean; canAct: boolean; online: boolean; pending: boolean;
  onAction: (type: 'roll' | 'move', token?: number) => void; onBot?: () => void; onBack: () => void; onRules: () => void; onShuffle?: () => void; onRematch: () => void; rematchAllowed?: boolean;
}) {
  const { shown, busy } = usePresentation(game, reduced, haptics);
  const current = game.players[game.turn];
  const available = legalMoves(game);
  const finished = game.phase === 'finished';
  const [hidden, setHidden] = useState(document.hidden);
  const lastCelebrated = useRef(game.phase === 'finished' ? game.id : '');
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (online || !current.bot || finished || busy || hidden || !onBot) return;
    const timer = setTimeout(onBot, reduced ? 350 : 650);
    return () => clearTimeout(timer);
  }, [online, current.bot, finished, busy, hidden, onBot, reduced]);
  useEffect(() => {
    if (!finished || shown.phase !== 'finished' || shown.id !== game.id || shown.revision !== game.revision || busy || reduced || hidden || lastCelebrated.current === game.id) return;
    let cancelled = false;
    let stopCelebration: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (!cancelled) {
        lastCelebrated.current = game.id;
        stopCelebration = () => confetti.reset();
        void confetti({ particleCount: 60, spread: 65, origin: { y: .65 }, disableForReducedMotion: true, ticks: 140 });
        timer = setTimeout(stopCelebration, 2500);
      }
    }).catch(error => console.error('Celebration could not load.', error));
    return () => { cancelled = true; clearTimeout(timer); stopCelebration?.(); };
  }, [finished, shown.phase, shown.id, shown.revision, busy, reduced, hidden, game.id, game.revision]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || (e.target instanceof HTMLElement && (e.target.closest('input,textarea,select,button,dialog') || e.target.isContentEditable))) return;
      if (e.code === 'Space' && canAct && !busy && !pending && game.phase === 'roll') {
        e.preventDefault();
        onAction('roll');
      } else if (canAct && !busy && !pending && game.phase === 'move') {
        const digit = Number(e.key);
        if (digit >= 1 && digit <= 4 && available.includes(digit - 1)) {
          e.preventDefault();
          onAction('move', digit - 1);
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [canAct, busy, pending, game.phase, available, onAction]);
  const winner = game.winner === null ? null : game.players[game.winner];
  const enabled = canAct && !busy && !pending && !finished;
  const turnColor = boardColors[current.color];
  const boardTitle = game.preset !== 'ludo' ? getBoard(game.preset, game.boardSeed).title : undefined;
  const reach = reachable(game);
  const suspense = !busy && game.phase === 'roll' && (reach.snakes.length || reach.ladders.length)
    ? [reach.snakes.length && `${reach.snakes.length} snake${reach.snakes.length > 1 ? 's' : ''}`, reach.ladders.length && `${reach.ladders.length} ladder${reach.ladders.length > 1 ? 's' : ''}`].filter(Boolean).join(' and ') + ` within reach of ${canAct ? 'your' : 'this'} next roll.`
    : '';
  return <section className="match">
    <div className="match-heading"><div><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {online ? 'Leave table' : 'All games'}</button><h1>{names[game.preset]}{game.preset === 'turbo' && <Zap size={23} />}{boardTitle && <span className="board-subtitle">{boardTitle}</span>}</h1></div><div className="match-actions">{onShuffle && <button className="button small secondary" onClick={onShuffle}><Shuffle size={15} /> Shuffle board</button>}<button className="button small secondary" onClick={onRules}>How to play</button></div></div>
    {!winner && <div className={`turn-banner ${current.color} ${canAct ? 'your-turn' : ''}`} style={{ ['--turn-color' as string]: turnColor }} role="status" aria-live="polite">
      <Avatar id={current.avatar} small />
      <div className="turn-banner-copy">
        <strong>{canAct ? `${current.name}, your turn` : `${current.name}'s turn`}</strong>
        {suspense && <span className="suspense-line">{reach.snakes.length ? "Careful! " : "Lucky chance! "}{suspense}</span>}
        <span>{busy ? 'Moving your piece...' : current.bot ? 'Making a move...' : !canAct ? 'Waiting for your friend.' : game.phase === 'move' ? `You rolled ${game.dice}. Choose a highlighted piece.` : 'Ready when you are.'}</span>
      </div>
      <span className="turn-step-pill">{game.phase === 'move' ? 'Choose a piece' : 'Roll the dice'}</span>
    </div>}
    {winner && !busy && <section className="winner-result" aria-labelledby="winner-title" style={{ ['--winner-color' as string]: boardColors[winner.color] }}>
      <div className="winner-portrait"><Trophy size={28} aria-hidden="true" /><Avatar id={winner.avatar} /></div>
      <div className="winner-copy" role="status"><p className="winner-eyebrow">{names[game.preset]} winner</p><h2 id="winner-title">{winner.name} wins!</h2><p>{game.preset === 'ludo' ? 'All four pieces home. Beautifully played.' : 'Home at last. Beautifully played.'}</p></div>
      <div className="winner-actions"><button className="button primary" disabled={pending || !rematchAllowed} onClick={onRematch}><RotateCcw size={17} /> {online ? 'Back to lobby' : 'Play again'}</button><button className="button secondary" onClick={onBack}><Home size={17} /> {online ? 'Leave table' : 'All games'}</button>{onShuffle && <button className="button secondary" onClick={onShuffle}><Shuffle size={17} /> New board</button>}{online && !rematchAllowed && <small>Waiting for the host to open the lobby.</small>}</div>
    </section>}
    <div className="match-layout"><div className={`board-wrap ${!finished ? 'turn-glow' : ''} ${canAct && !finished ? 'my-turn' : ''}`} style={{ ['--turn-color' as string]: turnColor }}>
      <GameBoard game={shown} theme={boardTheme} idle={!busy && !pending} turnLabel={finished ? undefined : canAct ? 'YOUR TURN' : current.bot ? 'BOT TURN' : 'THEIR TURN'} onToken={enabled && game.phase === 'move' ? token => onAction('move', token) : undefined} />
    </div>
      <aside className="match-sidebar">
        <div className="player-list" aria-label="Players">{game.players.map((p, i) => <div className={`match-player ${i === game.turn && !finished ? 'current' : finished ? '' : 'waiting'}`} style={{ ['--turn-color' as string]: boardColors[p.color] }} key={p.id}><Avatar id={p.avatar} small /><div><strong>{p.name}{i === game.turn && !finished && <span className="turn-chip">TURN</span>}</strong><small>{p.bot ? 'Friendly bot' : 'Player'}{game.preset === 'ludo' ? ` / ${game.positions[i].filter(pos => pos === 56).length} home` : ` · ${chessPieceInfo[p.piece].glyph} ${chessPieceInfo[p.piece].label} / ${game.positions[i][0] === 0 ? 'at start' : `square ${game.positions[i][0]}`}`}</small></div><PlayerMark color={p.color} /></div>)}</div>
        {!winner && <div className={`turn-panel ${current.color} ${canAct && !finished ? 'active-panel' : ''}`} style={{ ['--turn-color' as string]: turnColor }}>
          {
          <><div className="turn-label"><PlayerMark color={current.color} /><span>{canAct ? 'Your move' : `${current.name}'s turn`}</span></div><p className="turn-instruction">{busy ? 'Moving your piece...' : current.bot ? 'Your friendly bot is thinking.' : !canAct ? 'Waiting for your friend.' : game.phase === 'move' ? 'Choose a highlighted piece:' : 'Give the dice a little roll.'}</p>
            <button className={`roll-dice ${busy && game.events.some(e => e.type === 'roll') && !reduced ? 'rolling' : ''} ${enabled && game.phase === 'roll' ? 'ready-roll' : ''}`} disabled={!enabled || game.phase !== 'roll'} aria-label="Roll dice" onClick={() => onAction('roll')}>
              <DiceFace value={game.dice ?? 5} /><span>{pending ? 'Sending...' : busy ? 'Rolling...' : game.phase === 'move' ? `Rolled ${game.dice}` : 'Roll dice'}</span>
            </button>
            {game.phase === 'move' && <div className="token-tray" aria-label="Legal tokens">{available.map(t => {
              const pos = game.positions[game.turn][t];
              const dest = pos === -1 ? 'Enter start square' : pos + (game.dice ?? 0) === 56 ? 'Reach HOME! ★' : `Step ${pos} → ${pos + (game.dice ?? 0)}`;
              return <button key={t} className={`token-button ${current.color}`} disabled={!enabled} onClick={() => onAction('move', t)}>Move Token {t + 1}<small>{dest}</small></button>;
            })}</div>}
            <small className="turn-hint">{online ? 'No rush. This table waits for you.' : 'A little luck goes a long way.'}</small>
          </>}
        </div>}
        <div className="match-log" role="status" aria-live="polite" aria-atomic="true">{game.events.length ? game.events.map((event, i) => <p key={`${game.revision}-${i}`}>{event.text}</p>) : <p>{game.preset === 'ludo' ? 'Roll a six to bring a piece out of its base.' : 'Any roll gets you started. Reach the last square exactly.'}</p>}</div>
      </aside>
    </div>
  </section>;
}
function DiceFace({ value }: { value: number }) {
  const map: Record<number, number[]> = { 1: [4], 2: [0,8], 3: [0,4,8], 4: [0,2,6,8], 5: [0,2,4,6,8], 6: [0,2,3,5,6,8] };
  return <span className="dice-face" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} className={map[value].includes(i) ? 'pip' : ''} />)}</span>;
}
function Rules({ preset }: { preset: Preset }) {
  return <div className="rules-copy">{preset === 'ludo' ? <>
    <p>Race all four tokens around the board and into your matching home lane. First to tuck all four home wins.</p>
    <h3>Roll, choose, move</h3><p>A six brings a token out onto its entry square, or moves a token already on the board. Choose a highlighted token after rolling. You need an exact roll to finish.</p>
    <h3>A friendly rivalry</h3><p>Land on a rival on an unmarked square to send them back to base. Star squares are safe. Pieces can share squares and do not block the path.</p>
    <h3>One more go</h3><p>A six, a capture, or reaching home grants one extra roll. Bonuses do not stack. The third consecutive six is forfeited and ends the turn; previous moves stay. A non-six resets the six count.</p>
    <p>No legal move? Your turn passes automatically. A six still earns a bonus unless it is your third consecutive six.</p>
  </> : <><p>{preset === 'turbo' ? 'A shorter 64-square climb with extra ladders for a quicker little break.' : 'A classic 100-square adventure. Your next roll could change everything.'}</p><h3>Follow the numbers</h3><p>Start just outside the board. Any roll gets you moving. Land on the bottom of a ladder to climb, or a snake's head to slide down. Crossing one does nothing.</p><h3>Land just right</h3><p>Reach the last square with an exact roll to win. An overshoot stays put. Sixes do not give extra turns, and players can share a square.</p><p>This game is pure luck. Bots roll the same fair dice as you.</p></>}
    <h3>Playing with friends</h3><p>Everyone marks themselves ready before the host starts. Turns have no timer. If someone disconnects, their seat waits. After 15 seconds away, the host may explicitly replace them with a bot. Host controls transfer if the host stays disconnected.</p>
  </div>;
}
