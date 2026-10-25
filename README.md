# Little Table

A small, mobile-first home for Ludo and Snakes & Ladders. Play solo with fair bots, share one device, or invite friends to a private room. No accounts, public matchmaking, trackers, ads, or heavy game engine.

## Play

- **Ludo:** four pieces each, two to four players, clear legal-token buttons.
- **Snakes & Ladders:** Classic (100 squares) and Turbo (64 squares).
- **Board looks:** illustrated cartoon snakes, wooden ladders, a realistic Ludo board with glossy pawns, and four board themes: Sunny Meadow, Jungle Ruins, Midnight Manor, and Lava Peak. Snakes & Ladders has four tidy layouts per mode with a shuffle button.
- **Suspense:** before each Snakes & Ladders roll, squares holding snakes (red) or ladders (green) within reach of the next roll pulse on the board, and the turn banner calls them out.
- **Your little companion:** six animal avatars, 4,096 suggested guest-name combinations, shuffle, and an editable nickname. Local players can choose their own names/avatars, and seats can be bots. Duplicate online names are disambiguated within the room. Nicknames are display text, never authentication.
- **Private tables:** invite links/codes, readiness, bot seats, relaxed turns, reconnect and restart recovery, and rematches.
- **Comfort:** system/light/dark themes, sound-effect volume/mute, reduced motion, supported haptics, keyboard controls, and offline local play after caching.

## Requirements and commands

Use Node **22.14 or newer in the Node 22 LTS line**, npm, and a current browser. This version of Node exposes `node:sqlite` as an experimental API and emits a warning. No separate database installation is needed.

```powershell
npm ci
npm run build
npm start
```

Open http://localhost:3000. The one Node process serves the production frontend, HTTP API, WebSocket transport, and SQLite persistence.

For development, run these in two terminals:

```powershell
npm run dev:server
```

```powershell
npm run dev
```

Open the Vite address (normally http://localhost:5173). Vite proxies `/api` and `/socket.io` to port 3000. Use `npm start`, not `vite preview`, for friend-room testing.

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npx tsx scripts\room-load.ts
```

The browser tests require a production build. They start their own server on port 4173, using disposable test storage. Port 4180 is convenient for a separate manual preview:

```powershell
$env:PORT='4180'
npm start
```

## How to play

### Ludo

Two players use opposite red/yellow bases. Three/four use clockwise red, green, yellow, blue order.

- Roll six to deploy a token to its entry square, or choose to move an existing token six steps instead.
- Roll first, then explicitly choose a legal token using the board or large token buttons. A token needs an exact roll to finish.
- Landing on opponents on an unsafe square captures them, including stacked opponents. Stars/entry squares are safe. Friendly stacks do not block movement.
- Six, capture, or reaching home gives **one** extra roll. Bonuses do not stack.
- Third consecutive six forfeits that roll and ends the turn. Previously committed moves are not undone. Any non-six resets the count.
- No legal move passes automatically; a six still gives its bonus unless it is the third consecutive six.
- First to finish all four tokens wins. No blockades, teams, or regional rule switches.
- The bot uses the same legal actions/dice, prioritizing finish, capture, safety, deployment, and progress. It cannot see future rolls.

### Snakes & Ladders

Start at zero, just outside the board. Any roll enters. Follow the serpentine numbers. Landing on a ladder foot climbs; landing on a snake head slides. Crossing an endpoint has no effect. Resolve one transport per move, never a chain.

Reach square 100 (Classic) or 64 (Turbo) exactly. Overshoots stay put and end the turn. Sixes do not give extra turns. Pieces may share squares. First to finish wins. Bots do not have artificial difficulty: this is a luck game.

Turbo has a separately validated fixed layout, not just a new coat of paint. The seeded 10,000-run test measured:

| Layout | Median rolls | 90th percentile | Runs hitting 10,000-roll cap |
|---|---:|---:|---:|
| Classic | 35 | 71 | 0 |
| Turbo | 16 | 27 | 0 |

These are solo journey simulations under identical exact-finish rules, not promises about match duration. The test enforces Turbo median at most 70% of Classic and a lower p90.

## Private rooms and recovery

1. Choose a game, select **Friends**, and create a room.
2. Share the invite link or code. Friends choose their nickname/avatar and join.
3. Add bot seats if wanted. Every human marks ready; the host starts with two to four seats.
4. The server rolls dice and validates every move. Clients send intentions only.

Turns have no timer. An absent player retains their turn and pending dice. After 15 seconds away the host may explicitly replace them with a bot. Returning players cannot silently reclaim a replaced bot seat. If the host stays disconnected past the grace period, control transfers to the longest-present connected human.

The room and game survive process/container restarts: SQLite commits each mutation before the server acknowledges/broadcasts it. Retried commands are deduplicated; a lost acknowledgement cannot reroll a committed dice result. Reconnect always requests the latest authenticated snapshot, rather than relying on transport recovery.

The session is an opaque HttpOnly cookie; the server stores only its hash. **Keep cookies on the original device** to reclaim your seat. An invite identifies a room, not ownership of another player's seat. Clearing cookies loses that recovery identity. A nickname alone never restores someone else's seat.

The host returns results to the lobby; humans ready up again before a rematch. Bot turns pause when no human is online. Rooms expire after the configured idle retention, and sessions have bounded retention. Capacity, request-size, origin, and request-rate limits prevent unbounded rooms or traffic. Expiry and failed actions are reported explicitly.

## Docker

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
```

Open the exact configured `PUBLIC_ORIGIN`, initially http://localhost:3000. The app binds to the local host by default; for a public deployment use HTTPS rather than exposing an unauthenticated development server. Do not use `docker compose down -v` unless you intend to destroy saved games and sessions.

The multi-stage image uses Node 22 Debian slim, production dependencies only, non-root execution, a named `game-data` volume, health checks, log rotation, graceful shutdown, and a one-CPU/512 MiB limit. No Redis/PostgreSQL service is required.

For public HTTPS:

1. Point a real domain at your host and allow ports 80/443.
2. Set `DOMAIN=play.example.com` and `PUBLIC_ORIGIN=https://play.example.com` in `.env`.
3. Run `docker compose --profile https up --build -d`.

Caddy terminates HTTPS and proxies HTTP/WebSocket traffic to the app. Serve the frontend and API from the same origin. Keep `PUBLIC_ORIGIN` exact (scheme, hostname and port). Domain validation/certificate issuance requires a reachable domain and cannot be validated locally.

### Configuration

For direct Node operation set environment variables in the invoking shell. The Node entrypoint does not automatically load `.env`; Compose uses it for interpolation.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Listening interface; use `127.0.0.1` for a local-only process |
| `PUBLIC_ORIGIN` | request origin | Exact permitted public origin |
| `DATABASE_PATH` | `data\games.sqlite` | SQLite file; its directory must be writable |
| `DIST_PATH` | `dist` | Built static frontend |
| `DISCONNECT_GRACE_MS` | `15000` | Delay before replacement/host transfer |
| `ROOM_TTL_MS` | `86400000` | Idle room retention |
| `MAX_ROOMS` | `250` | Hard room capacity; this is a limit, not a certified load rating |
| `MAX_CONNECTIONS` | `500` | Hard connection capacity |

Changing defaults in direct Node operation does not automatically inject those values into Compose. Add explicit environment entries there when needed.

### Backups and upgrades

Back up the live WAL database with the supplied SQLite backup utility, **not** a plain copy of an open database file:

```powershell
node build\server\database.js backup data\games.sqlite backups\little-table.sqlite
```

For a container, create the backup inside the writable volume, then copy that specific file out:

```powershell
docker compose exec app node build/server/database.js backup /data/games.sqlite /data/backup.sqlite
docker compose cp app:/data/backup.sqlite .\little-table-backup.sqlite
```

Restore while the application is stopped, into a **new destination**:

```powershell
node build\server\database.js restore backups\little-table.sqlite data\restored.sqlite
$env:DATABASE_PATH='data\restored.sqlite'
npm start
```

The snapshot includes guest sessions, seats, current rolls, host, and deduplication records. Restrict backup access: it contains private game state and guest-session hashes. Test restore before upgrades. Startup validates schema/snapshot versions and rejects incompatible data rather than silently resetting active games. This is a single-process SQLite deployment; do not point several replicas at the same file.

## Offline and updates

The production service worker caches the small static application and game assets. Wait for **Solo & local ready offline** before expecting an offline reload. Your first-ever visit cannot work offline. The app does not depend on remote fonts or downloaded avatar images; emoji rendering follows the device's installed emoji font.

Only local/solo play works offline. Room API calls and socket traffic are never cached or queued. An interrupted online game remains an online game. Device storage holds one local match and your preferences, using validated versioned data. If storage is full/unavailable or data is corrupt, the UI explains that it cannot save/restore.

New app versions offer a refresh only outside an active match. Restoration/resynchronization skips historical sounds and move animations. No background music, continuous game loop, or game-state polling is used.

## Architecture

- `shared\game.ts`: pure rules, validated state, geometry, boards, bot, profiles. Local/server use the same transitions.
- `shared\protocol.ts`: runtime-validated room commands/snapshots.
- `src\App.tsx`: guest profile, setup, local orchestration, rooms and match UI.
- `src\components\Boards.tsx`: real responsive SVG game boards with text/large-button alternatives.
- `src\lib\presentation.ts`: bounded cancellable presentation of committed events, independent of the rules.
- `src\lib\audio.ts`: bounded Web Audio voices, gesture unlock, mute/gain, node cleanup, background suspension.
- `src\lib\rooms.ts`: lazy-loaded Socket.IO connection and full-state resynchronization.
- `server\`: HTTP/static/gzip, SQLite transactions, session identity, authoritative rooms, bots and lifecycle.
- `tests\`: engine, multiplayer, recovery/storage failures, accessibility, offline and browser journeys.

The original prototype's unused components remain preserved. The new app does not use its state-coupled Ludo component or legacy sound singleton. Both tiny board renderers ship together for actual home previews; online transport and celebration code are separate chunks. No framework migration or large UI kit was needed.

## Validation and remaining release checks

Automated engine tests cover deployment, every home-lane mapping, captures/stacks/safe squares, no moves, bonuses/third six, exact finish, invalid commands, immutable transitions, bot legality, both fixed layouts, and the Turbo threshold.

Backend tests cover distinct cookie identities, unique display names/avatars, readiness/permissions, malformed/client-authored outcomes, revisions, duplicate rolls, concurrent final-seat joins, host transfer/replacement, restart recovery, failed writes without success acknowledgements, and consistent backup/restore.

Browser tests cover profile/avatar persistence, local resume, complete Turbo matches and rematch, friend-room joins/seat restoration, cached offline play, narrow layouts, and automated WCAG AA checks for both themes, settings, setup, and an active board.

A bounded local load smoke test exercises **25 four-seat rooms / 100 clients / 400 legal turns / 25 reconnects**. It distinguishes handler latency (including SQLite commit) from network/event-loop roundtrip, reports RSS, and asserts drained sockets and cleared application timers/maps after shutdown. Local measurements are not container capacity certification.

Recorded local measurements (Windows / Node 22.14 / desktop Chromium, not a certified low-end mobile device):

| Check | Result |
|---|---|
| Production JavaScript, initial chunk | 78.6 KiB gzip |
| Initial CSS | 10.4 KiB gzip |
| Mobile Lighthouse on localhost | Performance 99, accessibility 100, best practices 100 |
| Lighthouse LCP / CLS / total blocking time | 1.6 s / 0 / 30 ms |
| Lighthouse page transfer | 94 KiB |
| 100-client server handler p95 | 3.06 ms (includes SQLite commit) |
| 100-client command roundtrip p95 | 59.35 ms (local transport and queue included) |
| Sampled process RSS at load | 115.4 MiB, including in-process test clients |
| 15 frontend create/play/leave cycles | 0.76 MiB retained JS heap increase after collection |

Lighthouse was run without simultaneous builds/load tests, using simulated mobile throttling. These are lab observations, not field INP or Internet service guarantees. Both small board renderers are included in the initial chunk; room transport (14.4 KiB gzip) and confetti (4.3 KiB gzip) load separately. The offline cache additionally fetches these optional chunks. Room and local flows use the same board bundle, so choosing a game does not pull a hidden large game engine.

Release limitations:

- Docker Compose configuration validates, but Docker Desktop cannot start its Linux engine in this environment. **The actual image build/container restart/resource-limit journey is not certified here.**
- Physical iPhone Safari, low-end Android, screen-reader listening, haptic feel, and sound quality on phone speakers/headphones require real-device checks. Desktop Chromium emulation is not a substitute.
- Mobile lab measurements cannot certify field INP or Internet latency. Use a representative deployed origin and real mobile data.
- `npm audit --omit=dev` is clean. Inherited Tailwind 3 build-tool advisories do not affect production dependencies; address them in a separately tested tooling upgrade rather than force-upgrading the styling framework.

Final automated run: production build passes, **35 engine/backend tests pass**, and **8 Chromium browser tests pass**. Browser checks additionally verify gesture-unlocked audio, one reused AudioContext, drained sound voices, mute/resume, keyboard focus restoration, and a cryptographic ID fallback for browsers that do not expose secure-context `randomUUID`.

## Troubleshooting

- **Cannot join:** verify the room code/link and network; inspect `PUBLIC_ORIGIN`, HTTPS and reverse proxy/WebSocket routing. Private invites cannot bypass full/expired/started-room policy.
- **Seat not reclaimed:** use the original browser cookie and invite; ask the host whether the absent seat was replaced.
- **No sound:** tap the sound control to unlock audio; check device/browser volume and mute. Audio failure does not prevent play.
- **Offline unavailable:** load the production app online and wait for its offline-ready indicator. Service workers require localhost or HTTPS.
- **Database unavailable:** verify volume ownership/write permissions and free disk. Failed persistence rejects an action instead of acknowledging a memory-only move.
- **Port occupied:** choose a different `PORT`; keep the public origin and proxy settings consistent.
- **SQLite experimental warning:** expected on Node 22.14; use the supported Node LTS container and rerun tests before changing runtime versions.
