// Scenario 3 (phone only): the worst case for a small screen, a 4-player table (three seats in the top row, the
// felt, a full hand). No screen may scroll sideways, no seat may overflow its frame, the cards in hand must be easy
// to tap (>= 44 px) and the seat buttons at least 24 px (WCAG 2.2 minimum target), and a real tap must play a card.
// Scenario 1 already plays a full deal on the emulated iPhone; this one checks the layout.
import { expect, test } from "@playwright/test";
import {
  createRoom,
  expectNoHorizontalScroll,
  expectVersion,
  joinRoom,
  leaveAll,
  readyAndStart,
  stateOf,
  withPlayers,
} from "./helpers";

const MIN_CARD_PX = 44;
const MIN_TAP_PX = 24;

test("4-player table fits a phone screen and a tap plays a card", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob", "Cris", "Dan"], async (players, room) => {
    const [host, ...guests] = players;

    await test.step("home page and the room list fit the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
      await host.page.getByTestId("tab-join").tap();
      await expect(host.page.getByRole("heading", { name: "Camere" })).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby with 4 players fits the screen", async () => {
      room.code = await createRoom(host);
      for (const g of guests) await joinRoom(g, room.code);
      await expect(host.page.getByTestId("lobby-players").locator("li[data-player-id]")).toHaveCount(4);
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("game screen fits, seats do not overflow, targets are big enough", async () => {
      await readyAndStart(players);
      for (const p of players) {
        await expect(p.page.getByTestId("seat")).toHaveCount(3);
        await expectNoHorizontalScroll(p.page);
        const overflow = await p.page.getByTestId("seat").evaluateAll((els) => els.map((e) => e.scrollWidth - e.clientWidth));
        expect(Math.max(...overflow), `widest seat overflow on ${p.name}'s screen`).toBeLessThanOrEqual(1);
        const cards = await p.page
          .getByTestId("my-hand")
          .getByRole("button")
          .evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
        expect(cards).toHaveLength(4);
        expect(Math.min(...cards), `smallest card in ${p.name}'s hand`).toBeGreaterThanOrEqual(MIN_CARD_PX);
      }
      // The host sees "Scoate" (and "Joacă pentru el" on the player on turn) in the narrow seats.
      const seatButtons = await host.page
        .getByTestId("seat")
        .getByRole("button")
        .evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
      expect(seatButtons.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...seatButtons), "smallest seat button").toBeGreaterThanOrEqual(MIN_TAP_PX);
    });

    await test.step("a tap plays a card, the other phones see it live", async () => {
      const s = await stateOf(host, room.code);
      expect(s.game?.turn).toBe(s.me.id); // the host leads round 1
      const card = s.game!.legal[0];
      const [res] = await Promise.all([
        host.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/play`) && r.request().method() === "POST"),
        host.page.getByTestId("my-hand").locator(`button[data-card="${card}"]`).tap(), // a touch tap, not a mouse click
      ]);
      expect(res.status()).toBe(200);
      const v = ((await res.json()) as { room: { version: number } }).room.version;
      for (const g of guests) {
        await expectVersion(g, v);
        await expect(g.page.getByTestId("trick-table").locator(`[data-card="${card}"]`)).toBeVisible();
        await expectNoHorizontalScroll(g.page);
      }
      await expect(host.page.getByTestId("my-hand").getByRole("button")).toHaveCount(3);
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([...guests, host]);
      room.closed = true;
    });
  });
});
