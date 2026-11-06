# webSepticaGame

Șeptică multiplayer, jocul clasic de cărți, pentru 2–4 prieteni, pe telefon. În 4 se poate juca și pe echipe (2 contra 2).
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast), deploy pe Vercel (regiunea `fra1`, Frankfurt).
Domeniu: https://septica.hailatat.icu

## Reguli

1. Pachet de 32 de cărți (7, 8, 9, 10, J, Q, K, A). În 3 jucători se scot 8♣ și 8♦ (rămân 30).
2. Fiecare are mereu 4 cărți. Nu ești obligat să răspunzi la culoare sau valoare: pui orice carte.
3. Cine începe mâna pune o carte. Pe rând, fiecare pune câte una. **Taie** o carte de aceeași valoare cu prima
   sau orice **7**.
4. După ce a pus toată lumea, dacă cel care a început a fost tăiat, poate **continua** cu o carte de aceeași valoare
   sau un 7 (și toată lumea mai pune câte o carte) sau poate **lăsa mâna**. Dacă nu are cu ce să continue,
   mâna se încheie singură.
5. Mâna o ia ultimul care a tăiat (sau cel care a început, dacă nu a tăiat nimeni). El trage primul din pachet,
   apoi ceilalți în ordine, până ajung toți la 4 cărți, și tot el începe mâna următoare.
6. Fiecare **10** și fiecare **As** = 1 punct (8 în total). La final câștigă cine are cele mai multe puncte.
   La egalitate pe primul loc (ex. 4–4), runda e egală și nu primește nimeni victoria.
7. **Pe echipe** (doar în 4): locurile 1 și 3 contra 2 și 4 (partenerii stau față în față), punctele partenerilor
   se adună. Echipele se aleg în lobby („Trec în Echipa X”); start doar la 2 contra 2.

### Extra

- **Lobby:** fiecare apasă „Sunt gata”. Host-ul împarte cărțile când sunt toți gata (minim 2, maxim 4 jucători).
- **Cine începe:** în runda 1 începe host-ul, apoi la fiecare rundă nouă începe următorul la masă.
- **După rundă:** host-ul alege „Rundă nouă” (aceiași jucători, se împarte direct) sau „Înapoi în lobby”
  (pot intra alții, se pot schimba echipele). Fiecare jucător are un contor de runde câștigate în cameră.
- **Joacă pentru el:** dacă cineva nu mai răspunde, host-ul poate juca în locul lui (cea mai mică carte, sau lasă mâna).
- **Părăsește / Scoate:** dacă pleacă cineva în timpul unei runde, runda se anulează (Șeptica nu poate continua cu
  un loc gol). Dacă pleacă host-ul, devine host următorul jucător. Când pleacă ultimul, camera se închide.
- **Închidere automată:** o cameră în lobby, sau după rundă, se închide după 2 minute în care nimeni nu o are deschisă.
- **Confirmare la jucarea cărții:** opțională, din Setări.

## Arhitectură, pe scurt

- Toată logica rulează în Route Handlers (`src/app/api/rooms/...`) cu **service role key**, doar pe server.
  Regulile sunt funcții pure în `src/lib/septica.ts` (testate cu Vitest, inclusiv sute de jocuri simulate).
- Runda curentă (pachet, mâini, masă, cărți luate) e un JSON în `septica_rooms.deal`. Clientul primește doar
  o vedere filtrată: mâna lui și câte cărți au ceilalți. Fiecare mutare verifică `version` (concurență optimistă).
- Tabelele au **RLS activat și nicio policy**, plus `revoke` pentru `anon`/`authenticated`.
- Live: după fiecare modificare, serverul trimite un semnal **Supabase Realtime Broadcast** pe `room:<uuid>`,
  fără date de joc; clientul face refetch la `/api/rooms/<cod>/state`. Polling la 15 s, ca rezervă.

## Setup

1. **Supabase** (proiectul comun al hub-ului): SQL Editor → rulează `supabase/schema.sql`.
   Creează doar `septica_rooms` și `septica_players`.
2. **Local:** `npm install`, `cp .env.example .env.local` (cele 3 valori), `npm run dev`, `npm test`.
3. **Vercel:** Import `florin2495/webSepticaGame` → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → Redeploy. Regiunea funcțiilor e fixată
   la `fra1` (Frankfurt) prin `vercel.json`.
4. **Domeniu:** Settings → Domains → `septica.hailatat.icu` (CNAME către valoarea afișată de Vercel).

## Limitări cunoscute

- Identitatea jucătorului e un token în `localStorage`; dacă îl ștergi, nu mai poți reintra în runda curentă.
- Nu există rate limiting. Maxim 4 jucători pe cameră, fără spectatori.
