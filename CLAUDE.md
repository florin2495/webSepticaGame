@AGENTS.md

# webSepticaGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webSepticaGame`, private). Never the work account.
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
| `supabase/migrations/003_seat_spectator.sql` | yes (2026-11-08, verified by effect: seat/role/queued_at selectable with the service key) | `septica_players.seat`, `role` ('player'/'spectator'), `queued_at` (reorder + spectators). Idempotent. Do not push the code before it runs. |
| hub `hub_leaderboard*` (owned by the hub repo) | yes (2026-11-08, verified: both tables answer 200; round report tested locally) | `src/lib/server/leaderboard.ts` writes to it at the end of a round (errors are swallowed). Do not push before the hub migration ran. |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify by effect with the service key.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (120 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (120 s, `septica.ts`)
  and with no player/spectator (`septica_players`) `last_seen_at` within 120 s is deleted (players cascade). Open room
  pages keep both fresh (`/state` polls every 15 s, stamps `last_seen_at` every 10 s and `last_activity_at` every 20 s),
  so only rooms nobody has open disappear. The 10-minute lobby/finished expiry stays too.

## Code map
- `src/lib/septica.ts` - pure rules (deck, deal, play, let go, scoring, seats/teams). Tested in `septica.test.ts`.
- `src/lib/server/room.ts` - load/auth, `saveRoom` (version check), `applyMove`, per-player `buildState`.
- `src/lib/server/deal.ts` - start a deal, balance teams. `membership.ts` - leave/kick (cancels a running round).
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
  re-joining with an existing nickname reclaims that seat (same player id, new token; team/ready/wins kept, pending
  kick cleared) from the same device (`device_hash`) or once the seat has been unseen for 45 s, also mid-deal.
  `/state` exposes only a derived `connected` flag ("deconectat" badge). Lobby/finished rooms close after 10 min idle.

## Testing
- `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 2, 3 and 4 players (incl. teams) against `npm run dev`; delete test rooms afterwards.

## Local testing notes
- `.env.local` has `LEADERBOARD_GAME=septica-test` so local runs never touch the real `septica` leaderboard rows. `node scripts/e2e.mjs http://localhost:3008/septica` refuses to run without it and deletes the test rows afterwards.
