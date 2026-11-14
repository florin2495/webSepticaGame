// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…" (never counted on the hub leaderboard); a leftover is deleted with the service
// key (env) as a safety net. The deal is random: every move is picked from the /state JSON of the player on turn
// (read with their stored token), then made by clicking that card (or "Las mâna") on their screen.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { RoomState } from "../../src/lib/types";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 15 s. */
export const REALTIME_MS = 5_000;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

/** Host creates a room (no password) from the home page; returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("ready")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (lands in the lobby, or as a spectator mid-deal). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
  await expect(p.page.getByTestId("room")).toBeVisible();
}

/** The room version on a player's screen (bumped by every deal write). */
export async function screenVersion(p: Player): Promise<number> {
  return Number(await p.page.getByTestId("room").getAttribute("data-version"));
}

/** Waits until a player's screen shows room version >= v (a newer state reached it). */
export async function expectVersion(p: Player, v: number, timeout = REALTIME_MS): Promise<void> {
  await expect.poll(() => screenVersion(p), { timeout, message: `${p.name}'s screen reaches version ${v}` }).toBeGreaterThanOrEqual(v);
}

/** /state of a player, read with the token their browser stored for the room. */
export async function stateOf(p: Player, code: string): Promise<RoomState> {
  const token = await p.page.evaluate((c) => JSON.parse(localStorage.getItem(`septica:session:${c}`) ?? "{}").token as string, code);
  expect(token, `${p.name} has a stored session`).toBeTruthy();
  const res = await p.page.request.get(`api/rooms/${code}/state`, { headers: { "x-player-token": token } });
  expect(res.status(), `${p.name}'s /state`).toBe(200);
  return (await res.json()) as RoomState;
}

/** Everyone clicks "Sunt gata", the host (players[0]) deals; every screen switches to the game within REALTIME_MS. */
export async function readyAndStart(players: Player[]): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("ready").click();
    await expect(p.page.getByTestId("ready")).toHaveText("Nu mai sunt gata");
  }
  const host = players[0];
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-game").click();
  for (const p of players) {
    await expect(p.page.getByTestId("room")).toHaveAttribute("data-status", "playing", { timeout: REALTIME_MS });
    await expect(p.page.getByTestId("my-hand").getByRole("button")).toHaveCount(4);
  }
}

/**
 * Makes one move for whoever is on turn, on their screen: a random legal card (clicked, or tapped on a touch
 * device), or "Las mâna" when allowed (sometimes, or when no card cuts). Every other screen (players and
 * `watchers`) must show the new state within REALTIME_MS, and a played card on its felt. Returns the new state
 * as the mover's action response carried it.
 */
export async function playMove(players: Player[], code: string, watchers: Player[] = []): Promise<RoomState> {
  const ref = await stateOf(players[0], code);
  const mover = players.find((p) => p.name === ref.players.find((x) => x.id === ref.game?.turn)?.nickname);
  if (!mover) throw new Error(`nobody on turn (turn=${ref.game?.turn})`);
  const mine = await stateOf(mover, code);
  const g = mine.game!;
  // The mover's screen must be current before it acts.
  await expectVersion(mover, mine.room.version);

  const letGo = g.canLetGo && (g.legal.length === 0 || Math.random() < 0.3);
  const card = letGo ? null : g.legal[Math.floor(Math.random() * g.legal.length)];
  if (!letGo && !card) throw new Error(`${mover.name} is on turn but has no legal card and cannot let go`);
  const action = letGo ? "let-go" : "play";
  const target = letGo ? mover.page.getByTestId("let-go") : mover.page.getByTestId("my-hand").locator(`button[data-card="${card}"]`);
  const touch = test.info().project.use.hasTouch === true;
  const [res] = await Promise.all([
    mover.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/${action}`) && r.request().method() === "POST"),
    touch ? target.tap() : target.click(),
  ]);
  expect(res.status(), `${mover.name}: ${action} ${card ?? ""}`).toBe(200);
  const next = (await res.json()) as RoomState;
  expect(next.room.version).toBeGreaterThan(mine.room.version);

  for (const other of [...players.filter((p) => p !== mover), ...watchers]) {
    await expectVersion(other, next.room.version);
    if (card) await expect(other.page.getByTestId("trick-table").locator(`[data-card="${card}"]`)).toBeVisible();
  }
  return next;
}

/** Plays the running deal to its end (every move live on the other screens). Returns the final state. */
export async function playDeal(players: Player[], code: string, watchers: Player[] = []): Promise<RoomState> {
  for (let moves = 0; moves < 300; moves++) {
    const s = await playMove(players, code, watchers);
    if (s.room.status !== "playing") return s;
  }
  throw new Error("the deal did not end within 300 moves");
}

/** Expected headline of the end-of-round panel for a finished (not aborted) deal. */
export function resultHeadline(s: RoomState): RegExp {
  const r = s.result!;
  return r.winners.length === 1 ? /câștigă!/ : /Egalitate!/;
}

/** Leaves through the "Părăsește" button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/septica_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
