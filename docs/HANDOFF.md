# HANDOFF – agentul Septica (008_Septica)

Document autonom pentru agentul care preia. Repo: `D:\_DEv\008_Septica` (Next.js cu breaking changes: citește `AGENTS.md`/`CLAUDE.md`
și `node_modules/next/dist/docs/` înainte de cod). Plan comun: `D:\_DEv\FEEDBACK_PLAN.md`.

## 1. Cerința inițială și mesajele primite

### Promptul inițial (de la sesiunea coordonator „Feedback și bug-uri jocuri", id `local_3ff01623-91e8-4a81-8b2e-a2e3ecbbeb86`)
> Septica (008_Septica) e unul din 12 repo-uri separate (hub + 11 jocuri) pe un singur proiect Supabase. Planul comun și contractele sunt în D:\_DEv\FEEDBACK_PLAN.md. Fiecare repo e lucrat de un agent separat; tu ești agentul Septica. Utilizatorul vrea un mock aprobat înainte de implementarea layout-ului.
>
> Task: Citește D:\_DEv\FEEDBACK_PLAN.md (reguli, contractele A–D și secțiunea „008_Septica"), apoi CLAUDE.md/AGENTS.md din repo și `src/components/Game.tsx`.
>
> Etapa 1 (OBLIGATORIE, apoi te oprești): fă un mock, fără să modifici jocul, al zonei cu jucătorii: jucătorul curent mereu jos; stânga = următorul la rând; sus = al 3-lea (coechipierul la joc pe echipe); dreapta = precedentul; opțional un pătrat „masă" în mijloc; trebuie să se vadă clar cine a început runda și cine urmează. Fă 2 sau 3 variante (de exemplu: masă cu 4 locuri, bandă de jucători în ordine, un hibrid), pentru 2, 3 și 4 jucători și în mod pe echipe, pe mobil (portret ~390 px) în prim-plan. Salvează mock-ul ca HTML static autonom în `docs/mock/septica-layout.html` (fără dependențe externe), deschide-l în browser-ul din aplicație pentru utilizator și spune-i în chat ce variantă recomanzi și de ce. Apoi oprește-te și așteaptă aprobarea utilizatorului. Nu implementa nimic din Game.tsx până nu aprobă.
>
> Etapa 2 (după aprobare): implementează layout-ul aprobat, apoi contractele A (reorder de host), B (spectator + „Intră la runda următoare"), C (raportare clasament, cod gata dar nepushat până rulează utilizatorul migrarea din hub) și D (bug-uri iOS: caută fixul în secțiunea „Fix iOS" din plan; dacă e gol, investighează singur).
>
> Reguli: nu face git push, bump patch în package.json, migrări numerotate și aditive cu prefixul jocului, rulează `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npx next build`. Identitatea git e deja fixată, nu o schimba. Comite pe main în pași mici. La final raportează.

### Mesaj coordonator: migrări (schimbare de proces)
> Nu îi cere utilizatorului să ruleze nimic, doar scrie fișierul. Utilizatorul vrea UN SINGUR script SQL cu toate migrările din toate repo-urile, rulat o dată de el; coordonatorul îl asamblează din fișierele voastre. Scrie migrările în `supabase/migrations/` (și în `supabase/schema.sql`) ca până acum, dar **idempotente** (`create table if not exists`, `add column if not exists`, `create index if not exists`, constraint-uri protejate cu verificare), ca scriptul să poată rula și a doua oară fără erori. Fără `drop`/`delete` de date existente. Nu bloca lucrul așteptând rularea. În raportul final scrie calea exactă a fiecărui fișier de migrare creat.

### Mesaj utilizator (aprobare layout)
> varianta a e mai buna, de asemenea varianta a o vreau si la rentz si la whist, daca nu exista deja o ordine.

**Varianta APROBATĂ = A, „Masă cu 4 locuri"** (din `docs/mock/septica-layout.html`): grilă 3 coloane (`1fr 1.15fr 1fr`); jucătorul curent jos
(mereu), stânga = următorul în ordinea de joc, sus = al 3-lea (la echipe = partenerul), dreapta = precedentul; pătratul „masă" verde în
mijloc, cărțile jucate stau în fața locului celui care le-a pus; badge-uri „a început" (leader-ul mâinii) și „urmează" / „rândul tău",
„partener", număr de loc. 3 jucători: doar stânga+dreapta (sus gol). 2 jucători: adversarul sus, masa pe toată lățimea.
Utilizatorul NU a ales varianta C pe care o recomandasem (bara „Ordine:" de jos nu e implementată).

### Mesaj coordonator: predare
Cerut: acest fișier, comis fără push. Un agent nou pe Opus 5.5 preia.

## 2. Ce s-a făcut (commit-uri, toate pe `main`, NEpushate)

| Commit | Conținut |
| --- | --- |
| `db148d9` | `docs/mock/septica-layout.html` – mock cu 3 variante (A masă, B bandă, C hibrid) |
| `0322c15` | Layout A + contractele A, B, C, D + migrarea 003 (un singur commit mare) |

Pe fiecare:
- **Layout A**: `src/components/Game.tsx` rescris (Seat/TrickTable/SEAT_CELL/FELT_SPOT; spectatorul privește de la locul 0, fără mână).
- **Contract A (reorder)**: `POST /api/rooms/[code]/reorder` (`src/app/api/rooms/[code]/reorder/route.ts`), doar host, doar status `lobby`/`finished`,
  validare permutare (`isPermutation`), scrie `septica_players.seat`. UI: `OrderControls` (săgeți ↑/↓) în `Game.tsx` (panoul de final de rundă) și în `Lobby.tsx`.
  `seatOrder(players, teams)` în `src/lib/septica.ts` folosește acum ordinea salvată (NU mai pune hostul primul); la echipe: [A0,B0,A1,B1] cu echipa primului jucător prima; `movedOrder` mută doar în cadrul aceleiași echipe.
- **Contract B (spectator)**: la `join` într-o cameră cu status ≠ lobby → rol `spectator` (max 16, `MAX_SPECTATORS` în `db.ts`); `requireMember` refuză spectatorii (403) dacă nu primește `{ allowSpectator: true }` (permis doar la `state`, `leave`, `queue`). `POST /api/rooms/[code]/queue` = toggle coadă (`queued_at`); în lobby un spectator intră direct dacă sunt locuri. `promoteQueued` (în `deal.ts`) rulează în `new-round` și în `lobby`: promovează în ordinea cozii cât timp sunt locuri (<4), resetează `ready/team/wins`. `buildState` expune `spectators` și `role`/`queued` pe jucători; spectatorul nu primește mâna (`hand` e `[]`, `legal` gol). UI: `src/components/Spectators.tsx` (listă + buton „Intră la runda următoare"; host poate scoate un spectator). Rejoin pentru spectatori funcționează prin ramura `existing` din `join`.
- **Contract C (clasament)**: `src/lib/server/leaderboard.ts` (`reportRound`), apelat din `applyMove` la final de rundă. Claim idempotent pe `hub_leaderboard_rounds(game='septica', room_code, round_no)` (eroare 23505 = deja numărat), apoi read-modify-write pe `hub_leaderboard` (nu e atomic; acceptabil, dedupe-ul pe rundă previne dublarea). La egalitate: +1 `games`, 0 `wins`. Rundele anulate (cineva a plecat) NU se raportează. Erorile sunt înghițite (log) ca să nu strice jocul. `player_key` = poreclă lowercase trimmed.
- **Contract D (iOS)**: aplicat exact fixul din planul Bingo (secțiunea „Fix iOS" din `FEEDBACK_PLAN.md`): `FeedbackButton.tsx` (fără autofocus, overlay scrollabil, dialog sus cu safe-area), `layout.tsx` (`maximumScale: 1`), `globals.css` (`text-size-adjust: 100%`, `overflow-x: clip` pe body). NEVERIFICAT pe iPhone real.
- `CLAUDE.md`: tabelul de migrări are rândurile pentru 003 și hub leaderboard (marcate „no").

## 3. Ce a rămas, în ordine

1. **Bump patch** în `package.json` (acum 0.3.5 → 0.3.6) + `npm install --package-lock-only` (nu s-a făcut; e cerut înainte de push, iar utilizatorul n-a cerut push).
2. **Verificare vizuală a layout-ului**: pornește `npm run dev` (preview_start; verifică `.claude/launch.json`), creează cameră cu 2/3/4 jucători (și pe echipe), 390 px portret; verifică că cardurile de pe masă nu se suprapun cu locurile, că seat-urile laterale (~105 px) încap cu butoanele „Scoate"/„Joacă pentru el", că badge-urile se văd. Nu s-a rulat aplicația deloc.
3. **Test end-to-end** (vezi `CLAUDE.md` → Testing și `scripts/e2e.mjs`): drive API cu 2/3/4 jucători, spectator care intră la mijloc de rundă, queue, reorder, new-round cu promovare; șterge camerele de test. Necesită migrarea 003 aplicată în DB-ul live (altfel `role`/`seat` nu există și tot jocul pică, pentru că `PLAYER_COLUMNS` le selectează). Nu rula contra DB-ului partajat înainte să fie rulat scriptul combinat.
4. Mesaje către Rentz/Whist: vezi §6.
5. Raport final către coordonator cu căile migrărilor (§5). NU push fără acordul explicit al utilizatorului.

## 4. Decizii și motivele

- Layout A cu ordinea fixă din `game.order` (număr de loc = index+1), nu relativ la jucătorul curent: numerele rămân aceleași pe toate ecranele și coincid cu lista de reorder.
- Spectator = coloane noi pe `septica_players` (`role`, `queued_at`, `seat`), nu tabel separat: păstrează rejoin-ul, unicitatea poreclei (index existent `room_id, lower(nickname)`) și kick-ul existente. `listPlayers` întoarce DOAR jucătorii (rol `player`), deci tot codul vechi (`startDeal`, `removePlayer`, `balanceTeams`) rămâne corect fără modificări.
- Dacă pleacă ultimul jucător, camera se șterge chiar dacă are spectatori (nu promovez spectatori automat).
- Camera plină (4) în lobby → eroare „Camera e plină", nu spectator (contractul vorbește doar de camere deja pornite).
- Pe echipe, săgețile mută doar în echipa jucătorului (partenerii stau față în față); „cine începe" la echipe = primul jucător din ordinea salvată; echipa lui e prima. Nu se poate muta între echipe din săgeți (se face din lobby, butoanele de echipă).
- „Începe" în `OrderControls`: runda 1 începe cu index 0, apoi leader-ul avansează (`roundLeader`); eticheta folosește `nextRound`.
- Promovarea din coadă resetează `wins` la 0 și `team` la null (+ `balanceTeams` pe echipe); la echipe poate rezulta echipe dezechilibrate → `teamProblem` afișează mesajul la start.
- `maximumScale: 1` dezactivează zoom-ul cu ciupire (prețul fixului din plan, impus de coordonator).

## 5. Migrări create

- **`D:\_DEv\008_Septica\supabase\migrations\003_seat_spectator.sql`** – `seat integer not null default 0`, `role text not null default 'player'` + check `septica_players_role_check` (în `do $$ … exception when duplicate_object`), `queued_at timestamptz`; backfill `seat` = ordinea de join per cameră (doar unde `seat = 0` și rn > 0); index `septica_players_room_role_seat_idx`. Idempotentă, fără drop/delete.
- Aceleași schimbări sunt și în **`D:\_DEv\008_Septica\supabase\schema.sql`** (coloane în `create table` + `alter table … add column if not exists` + constraint + index).
- Nicio migrare pentru clasament în acest repo: tabelele `hub_leaderboard*` aparțin hubului (agentul hub).

## 6. Ce s-a trimis la Whist / Rentz

- Către Rentz (`local_d845d79b-97bb-4a16-a522-82051a951c08`, „Rentz: A/B/C/D") și Whist (`local_6b21a028-f633-4851-a63e-fd22b08cdfdb`, „Whist: A/B/C/D"), mesaj livrat în coadă (neconfirmat citit): utilizatorul vrea layout-ul „varianta A" și acolo, **dacă nu există deja o ordine clară a locurilor**; mock-ul: `D:\_DEv\008_Septica\docs\mock\septica-layout.html`; implementarea de referință: `D:\_DEv\008_Septica\src\components\Game.tsx` (spus că va exista „după ce o termin").
- De făcut: după ce layout-ul e verificat, anunță-i că referința e gata (commit `0322c15`) și, dacă întreabă, pointează la `Game.tsx` (`seatPos`, `SEAT_CELL`, `FELT_SPOT`, `TrickTable`, `Seat`). Nu sunt dependențe de cod între repo-uri.
- Din greșeală am încercat să trimit și două mesaje „placeholder" la id-uri inexistente (au eșuat, nimic livrat).

## 7. Capcane, neverificat, stare teste

Stare la `0322c15`: `npm test` 34/34 OK; `npx eslint src` fără output (curat); `npx next build` OK (rutele `queue` și `reorder` apar); `npx tsc --noEmit` exit 0 (după `next build`, care regenerează tipurile `RouteContext`; fără el `tsc` dă erori false pe rutele noi).
- **Nu s-a rulat aplicația și nu s-a testat vizual nimic din Game.tsx/Lobby/Spectators**; nici API-ul e2e. Tot e doar compilat + unit-tested (`seatOrder`, `movedOrder`, `isPermutation`).
- **Nu pusha** înainte ca (a) scriptul combinat cu 003 să fie rulat de utilizator și (b) migrarea hub pentru clasament să existe. Fără 003 produce erori în toate rutele (coloanele din `PLAYER_COLUMNS`). Regula din `CLAUDE.md`: push doar cu acordul explicit, cu bump patch.
- Comportament schimbat de seatOrder: hostul NU mai e automat primul; acum e primul doar fiindcă `seat` la join e max+1 (hostul se creează primul, are `seat` 0 din default). Camerele vechi au backfill din migrare.
- `hub_leaderboard` upsert e read-modify-write (nu atomic) – două runde terminate simultan pe jucători comuni din camere diferite pot pierde un increment. Un RPC în hub l-ar rezolva.
- `GET /api/rooms` (lista de camere) numără toate rândurile din `septica_players` (inclusiv spectatori); irelevant în lobby, dar imprecis dacă un spectator e în lobby.
- Warning-uri CRLF→LF la `git add` (repo pe Windows); nu e o problemă.
- Eliberarea unui loc la plecarea unui jucător mid-round anulează runda (comportament existent); spectatorii nu sunt afectați.
- Sesiunea veche (Sonnet 5.5) a lăsat browser-ul pane cu viewport emulat 390×844 posibil; resetează cu `resize_window` preset desktop dacă e nevoie.
