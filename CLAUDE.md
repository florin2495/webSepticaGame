@AGENTS.md

# webSepticaGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webSepticaGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by the user manually; served at https://games.hailatat.icu/septica (`basePath`; the hub proxies it to web-septica-game.vercel.app).
  Functions run in `fra1` (Frankfurt, next to the Supabase DB) via `vercel.json`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `septica`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project of the hub)
ONE database, shared by local dev (`.env.local`) and production, and by all hub games.
Every object of this game is prefixed `septica_`. Table names live in `T` in `src/lib/server/db.ts`.
Migrations are run by hand in the Supabase SQL editor - this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-07, verified) | `septica_rooms`, `septica_players`; anon gets 401 |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `septica_players.kick_requested_at timestamptz` (kick during a game waits 10 s). Do not push the code before it runs. |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `septica_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Do not push the code before it runs. |
| `supabase/migrations/003_seat_spectator.sql` | yes (2026-11-08, verified by effect: seat/role/queued_at selectable with the service key; re-verified 2026-11-14 by effect: production E2E exercises its columns) | `septica_players.seat`, `role` ('player'/'spectator'), `queued_at` (reorder + spectators). Idempotent. Do not push the code before it runs. |
| hub `hub_leaderboard*` (owned by the hub repo) | yes (2026-11-08, verified: both tables answer 200; round report tested locally) | `src/lib/server/leaderboard.ts` writes to it at the end of a round (errors are swallowed). Do not push before the hub migration ran. |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify by effect with the service key.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (600 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (600 s, `septica.ts`)
  and with no player/spectator (`septica_players`) `last_seen_at` within 600 s is deleted (players cascade). Open room
  pages keep both fresh (`/state` polls every 60 s plus Realtime refetches; `last_seen_at` is stamped at most every 10 s
  and `last_activity_at` at most every 20 s), so only rooms nobody has open disappear. The 10-minute lobby/finished
  expiry stays too. Unit-tested with the DB mocked in `src/lib/server/room.test.ts` (`vitest.config.ts` resolves `@/`).
  A missing room answers 404 "Camera nu mai există (a fost închisă după inactivitate)." (`GONE`, no fixed duration).

## Code map
- `src/lib/septica.ts` - pure rules (deck, deal, play, let go, scoring, seats/teams). Tested in `septica.test.ts`.
- `src/lib/server/room.ts` - load/auth, `saveRoom` (version check), `applyMove`, per-player `buildState`.
- `src/lib/server/deal.ts` - start a deal, balance teams. `membership.ts` - leave/kick (cancels a running round).
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
  re-joining with an existing nickname reclaims that seat (same player id, new token; team/ready/wins kept, pending
  kick cleared) from the same device (`device_hash`) or once the seat has been unseen for 301 s (`DISCONNECT_MS`), also mid-deal.
  `/state` exposes only a derived `connected` flag ("deconectat" badge). Lobby/finished rooms close after 10 min idle.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed
runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger, the user's choice): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/septica.test.ts`, `kick.test.ts`, `reconnect.test.ts`, `server/room.test.ts`; no real DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/septica`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (cleanup safety net and the
  leaderboard check; the script falls back to `.env.local`). It checks that the deployed client JS contains the
  `package.json` version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- Test rooms are named `e2e-test-…` (`TEST_ROOM_PREFIX` in `septica.ts`): their rounds are never reported to the hub
  leaderboard (`applyMove` skips them), so tests against production never touch real `septica` leaderboard rows.
  `LEADERBOARD_GAME` (env override in `leaderboard.ts`) is for local dev only; CI does not use it.
- What E2E does: page / all `_next` assets / version / manifest / icons / `room/XXXXXX` over HTTP and that
  `web-septica-game.vercel.app/septica` serves the same build, then drives the real API (production DB): 3 players
  with a password (wrong / missing password, nickname taken, too long), room list (every room with status, players,
  spectators; no hash leak), rejoin (same device, old token dead), ready/start rules, spectator joining a running deal
  (no hand, 403 on player routes, queue toggle, rejoin), kick with "Ignoră", host plays for a player, illegal moves
  (out of turn, card not in hand, malformed, bad/no token, let go not allowed), a full 3-player deal with every trick
  winner and the score checked and hidden hands verified, no leaderboard row for the test room, reorder, new round
  (queued spectator promoted), leave mid-deal (cancelled), lobby, 2 vs 2 teams full deal, kicks, host hand-over, last
  one out closes the room, a 2-player room with a pending kick enforced after 10 s. Never calls `/api/feedback`.
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 60 s, so this checks Realtime). The deal is random: each move is picked from the
  `/state` JSON of the player on turn (token from their localStorage) and made by clicking that card / "Las mâna":
  - `game.e2e.ts` (both projects): two browser contexts create a room, join by link, ready, deal, play the whole deal
    (each move seen live on the other screen: room version + the card on the felt), end-of-round panel, new round,
    guest leaves mid-round (host sees it cancelled), host leaves.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-deal = spectator (no hand, no player buttons),
    the players see them, queue ("în coadă" seen by the players), they see every move and the end, the new round
    seats them.
  - `mobile.e2e.ts` (iPhone only): 4-player table; no horizontal scroll on home / room list / lobby / game, no seat
    overflows its frame, hand cards >= 44 px, seat buttons >= 24 px, a touch tap plays a card seen live.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- Test ids used by `tests/ui` (renaming or removing one breaks it): `home-submit`, `tab-create` / `tab-join`,
  `room-list` (items with `data-code`, `data-status`), `join-submit`, `room` (the room `<main>`, with `data-status`,
  `data-round`, `data-version`), `room-code`, `leave`, `lobby-players` (rows with `data-player-id`, `data-ready`),
  `ready`, `start-game`, `my-hand` (card buttons with `data-card`, `data-legal`), `trick-table` (cards with
  `data-card`), `seat` (`data-player-id`, `data-turn`), `game-status`, `let-go`, `scoreboard`, `finished-panel`,
  `new-round`, `back-to-lobby`, `spectator-list` (chips with `data-player-id`, `data-queued`), `spectator-status`,
  `queue-toggle` (`data-queued`).

