// End-to-end test of the Șeptică API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /septica]
// Plain Node 20+ fetch, no dependencies. Run by .github/workflows/e2e.yml against the deployed site.
// Every room is named e2e-test-... (never counted on the hub leaderboard) and removed at the end: everyone leaves,
// then leftovers are deleted in the DB with the service key (env NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, else .env.local). Never sends feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/septica").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const envFile = () => {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
};
/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return envFile();
}
const HAS_KEY = () => !!(supabaseEnv().NEXT_PUBLIC_SUPABASE_URL && supabaseEnv().SUPABASE_SERVICE_ROLE_KEY);
// A local server reports to a throwaway leaderboard game (LEADERBOARD_GAME in .env.local), never to "septica".
// Against the deployed site the game is "septica"; test rooms (e2e-test-*) must never be reported there.
const LB_GAME = LOCAL ? envFile().LEADERBOARD_GAME : "septica";
async function rest(path, init = {}) {
  const env = supabaseEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}` } });
  return res.status === 204 ? [] : res.json();
}
const lbRows = (roomCode) => rest(`hub_leaderboard_rounds?game=eq.${LB_GAME}&room_code=eq.${roomCode}`);

const sleep =(ms) => new Promise((r) => setTimeout(r, ms));
const roomName = (tag) => `e2e-test-${tag}-${Date.now().toString(36)}`.slice(0, 40);

// Minimal copy of the rules, to check the server's trick winner and scoring.
const rankOf = (c) => c.slice(0, -1);
const cuts = (c, lead) => rankOf(c) === lead || rankOf(c) === "7";
const points = (cards) => cards.filter((c) => rankOf(c) === "10" || rankOf(c) === "A").length;
function holder(plays) {
  const lead = rankOf(plays[0].card);
  let h = plays[0].playerId;
  for (const p of plays.slice(1)) if (cuts(p.card, lead)) h = p.playerId;
  return h;
}

async function states(code, players) {
  const out = {};
  for (const p of players) {
    const r = await call(`/api/rooms/${code}/state`, { token: p.token });
    if (r.status !== 200) throw new Error(`state ${p.name}: ${r.status} ${r.data.error}`);
    out[p.playerId] = r.data;
  }
  return out;
}

/** Hidden info: each player sees only their own hand; the hands never overlap; no raw deal fields leak. */
function checkVisibility(all, players, deckSize) {
  const seen = new Set();
  let ok = true;
  let total = 0;
  for (const p of players) {
    const s = all[p.playerId];
    const raw = JSON.stringify(s);
    if (/"(hands|stock|captured|token_hash|device_hash|password_hash|token)"/.test(raw)) ok = false;
    if (s.game.hand.length !== s.game.handCounts[p.playerId]) ok = false;
    for (const c of s.game.hand) {
      if (seen.has(c)) ok = false;
      seen.add(c);
    }
    total += s.game.hand.length;
  }
  const ref = all[players[0].playerId].game;
  const captured = ref.sides.reduce((a, x) => a + x.cards, 0);
  const sum = total + ref.stockCount + ref.trick.length + captured;
  return ok && sum === deckSize;
}

/**
 * Plays the running deal to its end. Random legal cards; when deciding, continues or lets go at random.
 * Checks the turn order, every trick winner and the final score. Returns the number of moves.
 */
async function playDeal(code, players, deckSize, { invalidChecks = false } = {}) {
  const byId = Object.fromEntries(players.map((p) => [p.playerId, p]));
  let moves = 0;
  let trickOk = true;
  let visOk = true;
  let lastTrickCount = 0;
  let all = await states(code, players);
  if (invalidChecks) {
    const g = all[players[0].playerId].game;
    const turnP = byId[g.turn];
    const other = players.find((p) => p.playerId !== g.turn);
    const otherCard = all[other.playerId].game.hand[0];
    check((await call(`/api/rooms/${code}/play`, { token: other.token, body: { card: otherCard } })).status === 409, "play out of turn = 409");
    const notMine = ["7S", "8S", "9S", "10S", "JS", "QS", "KS", "AS", "7H", "9H", "JH", "QH", "KH", "AH"].find(
      (c) => !all[turnP.playerId].game.hand.includes(c),
    );
    check((await call(`/api/rooms/${code}/play`, { token: turnP.token, body: { card: notMine } })).status === 409, "card not in hand = 409");
    check((await call(`/api/rooms/${code}/play`, { token: turnP.token, body: { card: "1Z" } })).status === 400, "malformed card = 400");
    check((await call(`/api/rooms/${code}/play`, { token: "bogus-token", body: { card: otherCard } })).status === 401, "bad token = 401");
    check((await call(`/api/rooms/${code}/play`, { body: { card: otherCard } })).status === 401, "no token = 401");
    check((await call(`/api/rooms/${code}/let-go`, { token: turnP.token, body: {} })).status === 409, "let go when not allowed = 409");
    check((await call(`/api/rooms/${code}/skip`, { token: players.find((p) => p.playerId !== all[p.playerId].room.hostPlayerId).token, body: {} })).status === 403, "non-host skip = 403");
    check(all[other.playerId].game.legal.length === 0, "player not on turn has no legal cards");
  }
  while (all[players[0].playerId].room.status === "playing" && moves < 400) {
    if (moves % 5 === 0) visOk &&= checkVisibility(all, players, deckSize);
    const g = all[players[0].playerId].game;
    const p = byId[g.turn];
    const mine = all[p.playerId].game;
    let res;
    if (mine.canLetGo && (mine.legal.length === 0 || Math.random() < 0.5)) {
      res = await call(`/api/rooms/${code}/let-go`, { token: p.token, body: {} });
    } else {
      const card = mine.legal[Math.floor(Math.random() * mine.legal.length)];
      if (mine.phase === "decide" && !cuts(card, rankOf(mine.trick[0].card))) trickOk = false;
      res = await call(`/api/rooms/${code}/play`, { token: p.token, body: { card } });
    }
    if (res.status !== 200) {
      check(false, `move failed: ${res.status} ${res.data.error}`);
      break;
    }
    moves++;
    all = await states(code, players);
    const ng = all[players[0].playerId].game;
    if (ng.tricksPlayed !== lastTrickCount && ng.lastTrick) {
      lastTrickCount = ng.tricksPlayed;
      if (ng.lastTrick.winner !== holder(ng.lastTrick.plays)) trickOk = false;
      if (ng.lastTrick.points !== points(ng.lastTrick.plays.map((x) => x.card))) trickOk = false;
      if (all[players[0].playerId].room.status === "playing" && ng.leader !== ng.lastTrick.winner) trickOk = false;
    }
    // Everybody sees the same table.
    const ref = JSON.stringify([ng.turn, ng.trick, ng.handCounts, ng.stockCount, ng.sides]);
    for (const q of players) {
      const qg = all[q.playerId].game;
      if (JSON.stringify([qg.turn, qg.trick, qg.handCounts, qg.stockCount, qg.sides]) !== ref) visOk = false;
    }
  }
  check(trickOk, "every trick went to the last cutter, points counted right");
  check(visOk, "each player sees only own hand, cards conserved, same table for everyone");
  return { moves, all };
}

function checkResult(all, players, expectSides) {
  const s = all[players[0].playerId];
  check(s.room.status === "finished" && s.result && s.game.turn === null, "deal finished");
  const r = s.result;
  check(r.sides.length === expectSides && r.sides.reduce((a, x) => a + x.points, 0) === 8, `${expectSides} sides, 8 points in total`);
  const best = Math.max(...r.sides.map((x) => x.points));
  const winners = r.sides.filter((x) => x.points === best).map((x) => x.index);
  check(JSON.stringify(winners) === JSON.stringify(r.winners), `winners = most points (${r.sides.map((x) => x.points).join("-")})`);
  check(s.game.hand.length === 0 && s.game.stockCount === 0, "all cards played");
  return r;
}

async function httpChecks() {
  console.log("HTTP");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200 && html.includes("Șeptică"), `page 200 (${page.status})`);
  // The settings panel (with the version) is only on the room page: collect the chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/ABCDEF`)).text();
  const assets = [...new Set((html + roomHtml).match(new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\]+\\.(?:js|css)`, "g")) ?? [])];
  const assetStatus = await Promise.all(assets.map(async (a) => (await fetch(ORIGIN + a)).status));
  check(assets.length > 0 && assetStatus.every((x) => x === 200), `${assets.length} ${BASE_PATH}/_next assets, all 200`);
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of assets.filter((x) => x.endsWith(".js"))) if ((await (await fetch(ORIGIN + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version}`);
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === "/septica/", "manifest 200, start_url /septica/");
  let iconsOk = true;
  for (const src of [...(manifest?.icons ?? []).map((i) => i.src), "/septica/icons/180", "/septica/favicon.ico"]) {
    const r = await fetch(ORIGIN + src);
    if (r.status !== 200 || !/image/.test(r.headers.get("content-type") ?? "")) iconsOk = false;
  }
  check(iconsOk, "icons + favicon 200 image/*");
  check((await fetch(`${BASE}/room/ABCDEF`)).status === 200, "GET /septica/room/ABCDEF 200");
  check((await call("/api/rooms/ABCDEF/state", { token: "x" })).status === 404, "unknown room state = 404");
  if (!LOCAL && ORIGIN !== "https://web-septica-game.vercel.app") {
    const v = await fetch("https://web-septica-game.vercel.app/septica");
    const vhtml = await v.text();
    const vAssets = vhtml.match(/\/septica\/_next\/static\/[^"']+\.js/g) ?? [];
    check(v.status === 200 && vAssets.length > 0 && vAssets.some((a) => html.includes(a)), "vercel.app/septica serves the same build");
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  if (LOCAL && (!LB_GAME || LB_GAME === "septica")) throw new Error("Set LEADERBOARD_GAME=septica-test in .env.local first: the shared DB holds the real leaderboard.");
  await httpChecks();

  console.log("Create, list, join (3 players, password)");
  const dev = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() };
  const r = await call("/api/rooms", { body: { name: roomName("ffa"), nickname: "Ana", password: "pw", deviceId: dev.A } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname, deviceId) => ({ ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId } })).data, name: nickname });
  let B = await join("Bob", dev.B);
  const C = await join("Cris", dev.C);
  check(!!B.token && !!C.token, "Bob and Cris joined");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: dev.D } })).status === 409, "nickname of a connected seat from another device = 409");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "x".repeat(13), password: "pw" } })).status === 400, "13-char nickname = 400");
  const list = await call("/api/rooms");
  check(
    list.data.rooms?.some((x) => x.code === code && x.hasPassword && x.players === 3 && x.status === "lobby" && x.spectators === 0),
    "room in public list: lobby, with password, 3 players, 0 spectators",
  );
  check(!JSON.stringify(list.data).includes("scrypt"), "list does not leak the password hash");

  console.log("Rejoin with the same device");
  const B2 = await join("Bob", dev.B);
  check(B2.playerId === B.playerId && B2.token !== B.token, "same seat, new token");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token = 401");
  B = { ...B2, name: "Bob" };

  console.log("Ready and start");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with players not ready = 409");
  for (const p of [A, B, C]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { teams: true } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  let all = await states(code, [A, B, C]);
  let s = all[A.playerId];
  check(s.room.status === "playing" && s.game.turn === A.playerId && s.game.order[0] === A.playerId, "host leads round 1");
  check([A, B, C].every((p) => all[p.playerId].game.hand.length === 4) && s.game.stockCount === 30 - 12, "3 players: 30-card deck, 4 cards each");
  console.log("Spectator joins a running deal");
  const specJoin = await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw", deviceId: dev.D } });
  check(specJoin.status === 200 && !!specJoin.data.token, "joining a running deal = spectator (200)");
  const D = { ...specJoin.data, name: "Dan" };
  const sp = (await call(`/api/rooms/${code}/state`, { token: D.token })).data;
  check(sp.me?.role === "spectator" && sp.game.hand.length === 0 && sp.game.legal.length === 0, "spectator has no hand and no legal cards");
  check(!/"(hands|stock|token_hash|device_hash)"/.test(JSON.stringify(sp)) && sp.game.stockCount === 30 - 12, "spectator state leaks nothing private");
  check(sp.players.length === 3 && sp.spectators.length === 1, "spectator not counted among the players");
  const list2 = await call("/api/rooms");
  check(
    list2.data.rooms?.some((x) => x.code === code && x.status === "playing" && x.players === 3 && x.spectators === 1),
    "running room still listed: status playing, 3 players, 1 spectator",
  );
  check((await call(`/api/rooms/${code}/play`, { token: D.token, body: { card: "7S" } })).status === 403, "spectator cannot play (403)");
  check((await call(`/api/rooms/${code}/ready`, { token: D.token, body: { ready: true } })).status === 403, "spectator cannot ready (403)");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, B.playerId, C.playerId] } })).status === 409, "reorder mid-deal = 409");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: {} })).status === 409, "player cannot queue (409)");
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === true, "Dan queues for next round");
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === false, "queue toggles off");
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === true, "queue toggles on");
  const specRejoin = await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw", deviceId: dev.D } });
  check(specRejoin.status === 200 && specRejoin.data.playerId === D.playerId, "spectator rejoin keeps the seat");
  D.token = specRejoin.data.token;

  console.log("Kick with Ignoră");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: C.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: C.playerId } })).data.pending === true, "kick in game is pending");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).data.me?.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: C.token, body: {} })).status === 200, "Ignoră");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).data.me?.kickRemainingMs === null, "kick cleared");

  console.log("Host plays for a player");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  const before = s.game.handCounts[s.game.turn];
  check((await call(`/api/rooms/${code}/skip`, { token: A.token, body: {} })).status === 200, "skip (joacă pentru el)");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.game.trick.length === 1 && s.game.handCounts[A.playerId] === before - 1, "lowest card played for the player on turn");

  console.log("Full deal, 3 players");
  const d1 = await playDeal(code, [A, B, C], 30, { invalidChecks: true });
  const r1 = checkResult(d1.all, [A, B, C], 3);
  check(d1.all[A.playerId].game.tricksPlayed > 0, `${d1.moves} moves, ${d1.all[A.playerId].game.tricksPlayed} tricks`);
  if (r1.winners.length === 1) {
    const w = r1.sides[r1.winners[0]].members[0];
    check(d1.all[A.playerId].players.find((p) => p.id === w)?.wins === 1, "winner's wins = 1");
  } else check(d1.all[A.playerId].players.every((p) => p.wins === 0), "draw: nobody gets a win");
  check((await call(`/api/rooms/${code}/play`, { token: A.token, body: { card: "7S" } })).status === 409, "play after the end = 409");

  console.log("Leaderboard: test rooms are never reported");
  if (HAS_KEY() && LB_GAME) {
    const rows = await lbRows(code);
    check(Array.isArray(rows) && rows.length === 0, `no hub_leaderboard_rounds row for the e2e-test room (game ${LB_GAME})`);
  } else console.log("  (skipped: needs the DB service key)");

  console.log("Reorder (host, between rounds)");
  const ids3 = [A.playerId, B.playerId, C.playerId];
  const newOrder = [C.playerId, A.playerId, B.playerId];
  check((await call(`/api/rooms/${code}/reorder`, { token: B.token, body: { order: newOrder } })).status === 403, "non-host reorder = 403");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, B.playerId] } })).status === 400, "incomplete order = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, A.playerId, B.playerId] } })).status === 400, "duplicate in order = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [...ids3, D.playerId] } })).status === 400, "spectator in order = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: newOrder } })).status === 200, "host reorders");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(JSON.stringify(s.players.map((p) => p.id)) === JSON.stringify(newOrder), "players listed in the saved order");

  console.log("New round: Dan is promoted from the queue");
  check((await call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "playing" && s.room.round === 2 && s.players.length === 4 && s.spectators.length === 0, "round 2 with 4 players, no spectators");
  check(JSON.stringify(s.game.order) === JSON.stringify([...newOrder, D.playerId]), "saved order kept, Dan appended last");
  check(s.game.turn === s.game.order[1], "round 2: next seat leads");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).data.game.hand.length === 4, "Dan is a player now: has a hand");

  console.log("Leave mid-deal");
  check((await call(`/api/rooms/${code}/leave`, { token: C.token, body: {} })).status === 200, "Cris leaves");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "finished" && s.result?.aborted?.nickname === "Cris" && s.result.winners.length === 0, "deal cancelled, no winner");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "Cris's token no longer works");

  console.log("Back to lobby, teams of 2 vs 2");
  check((await call(`/api/rooms/${code}/lobby`, { token: A.token, body: {} })).status === 200, "host back to lobby");
  const C2 = await join("Cris", dev.C);
  check(!!C2.token, "Cris joins the lobby (Dan is already seated)");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Eva", password: "pw" } })).status === 409, "5th player in the lobby = 409 (full)");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { teams: true } })).status === 200, "host turns teams on");
  const team = [A, B, C2, D];
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.players.filter((p) => p.team === 0).length === 2 && s.players.filter((p) => p.team === 1).length === 2, "teams balanced 2-2");
  // Ana + Cris vs Bob + Dan.
  const teamOf = { [A.playerId]: 0, [C2.playerId]: 0, [B.playerId]: 1, [D.playerId]: 1 };
  for (const p of team) {
    const cur = s.players.find((x) => x.id === p.playerId).team;
    if (cur !== teamOf[p.playerId]) await call(`/api/rooms/${code}/team`, { token: p.token, body: { team: teamOf[p.playerId] } });
  }
  check((await call(`/api/rooms/${code}/team`, { token: A.token, body: { team: 2 } })).status === 400, "team 2 = 400");
  for (const p of team) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts the team game");
  all = await states(code, team);
  s = all[A.playerId];
  const o = s.game.order;
  check(s.game.teams && teamOf[o[0]] === teamOf[o[2]] && teamOf[o[1]] === teamOf[o[3]] && teamOf[o[0]] !== teamOf[o[1]], "partners sit opposite");
  check(s.game.stockCount === 32 - 16, "4 players: 32-card deck");

  console.log("Full deal, teams");
  const d2 = await playDeal(code, team, 32);
  const r2 = checkResult(d2.all, team, 2);
  check(r2.sides.every((x) => x.members.length === 2 && teamOf[x.members[0]] === teamOf[x.members[1]]), "team sides group the partners");
  if (r2.winners.length === 1) {
    const ws = r2.sides[r2.winners[0]].members;
    check(d2.all[A.playerId].players.filter((p) => ws.includes(p.id)).every((p) => p.wins >= 1), "both partners get the win");
  }

  console.log("Kick in the finished state, leave");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host cannot kick self");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: "not-a-uuid" } })).status === 404, "kick unknown player = 404");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } })).status === 200, "host kicks Dan (immediate)");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "Dan is out");
  check((await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} })).status === 200, "host leaves");
  s = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  check(s.room?.hostPlayerId === B.playerId && s.me.isHost, "host passes to Bob");
  for (const p of [C2]) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: B.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);

  console.log("2 players, no password, pending kick enforced");
  const r3 = await call("/api/rooms", { body: { name: roomName("duo"), nickname: "Ion" } });
  const code3 = r3.data.code;
  created.add(code3);
  const I = { ...r3.data, name: "Ion" };
  const J = { ...(await call(`/api/rooms/${code3}/join`, { body: { nickname: "Jan", deviceId: randomUUID() } })).data, name: "Jan" };
  for (const p of [I, J]) await call(`/api/rooms/${code3}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code3}/start`, { token: I.token, body: {} })).status === 200, "2-player deal starts");
  check((await call(`/api/rooms/${code3}/kick`, { token: I.token, body: { playerId: J.playerId } })).data.pending === true, "kick Jan (pending)");
  await sleep(12_500);
  check((await call(`/api/rooms/${code3}/state`, { token: J.token })).status === 401, "kick enforced after 12 s");
  s = (await call(`/api/rooms/${code3}/state`, { token: I.token })).data;
  check(s.room?.status === "finished" && s.result?.aborted?.nickname === "Jan", "deal cancelled by the kick");
  check((await call(`/api/rooms/${code3}/leave`, { token: I.token, body: {} })).data.roomClosed === true, "room closed");
  created.delete(code3);

}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (LOCAL && LB_GAME && LB_GAME !== "septica") {
    await rest(`hub_leaderboard?game=eq.${LB_GAME}`, { method: "DELETE" });
    await rest(`hub_leaderboard_rounds?game=eq.${LB_GAME}`, { method: "DELETE" });
  }
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/septica_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
