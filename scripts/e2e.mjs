// End-to-end test of the Șeptică API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /septica]
// Plain Node 20+ fetch, no dependencies. Every room is named e2e-test-... and removed at the end
// (everyone leaves; leftovers are deleted in the DB with the service key from .env.local, if present).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/septica").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const assets = [...new Set(html.match(/\/septica\/_next\/static\/[^"']+\.(js|css)/g) ?? [])];
  let assetsOk = assets.length > 0;
  for (const a of assets.slice(0, 8)) if ((await fetch(ORIGIN + a)).status !== 200) assetsOk = false;
  check(assetsOk, `${assets.length} /septica/_next assets, first 8 return 200`);
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
  if (ORIGIN !== "https://web-septica-game.vercel.app") {
    const v = await fetch("https://web-septica-game.vercel.app/septica");
    const vhtml = await v.text();
    const vAssets = vhtml.match(/\/septica\/_next\/static\/[^"']+\.js/g) ?? [];
    check(v.status === 200 && vAssets.length > 0 && vAssets.some((a) => html.includes(a)), "vercel.app/septica serves the same build");
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
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
  check(list.data.rooms?.some((x) => x.code === code && x.hasPassword && x.players === 3), "room in public list, with password and 3 players");
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
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw", deviceId: dev.D } })).status === 409, "joining a running deal = 409");

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

  console.log("New round");
  check((await call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "playing" && s.room.round === 2 && s.game.turn === s.game.order[1], "round 2, next seat leads");

  console.log("Leave mid-deal");
  check((await call(`/api/rooms/${code}/leave`, { token: C.token, body: {} })).status === 200, "Cris leaves");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "finished" && s.result?.aborted?.nickname === "Cris" && s.result.winners.length === 0, "deal cancelled, no winner");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "Cris's token no longer works");

  console.log("Back to lobby, teams of 2 vs 2");
  check((await call(`/api/rooms/${code}/lobby`, { token: A.token, body: {} })).status === 200, "host back to lobby");
  const C2 = await join("Cris", dev.C);
  const D = await join("Dan", dev.D);
  check(!!C2.token && !!D.token, "Cris and Dan join the lobby");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Eva", password: "pw" } })).status === 409, "5th player = 409");
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

  console.log("Feedback (no rows written)");
  check((await call("/api/feedback", { body: { message: "", nickname: "e2e" } })).status === 400, "empty feedback = 400");
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
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
