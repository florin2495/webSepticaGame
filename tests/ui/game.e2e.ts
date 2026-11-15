// Scenario 1: two real browsers play a live deal on the deployed site: create, join by link, ready, deal, every
// move (card or "Las mâna") reaches the other screen through Realtime (well under the 60 s polling fallback), the
// end-of-round panel, a new round followed live, leave mid-round (round cancelled), leave. Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playDeal, readyAndStart, REALTIME_MS, resultHeadline, withPlayers } from "./helpers";

test("two players play a live deal to the end", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("ready")).toBeVisible();
      await expect(host.page.getByTestId("lobby-players")).toContainText(guest.name, { timeout: REALTIME_MS });
    });

    await test.step("both get ready, the host deals", () => readyAndStart(players));

    await test.step("each sees the other in the top row and four cards in hand", async () => {
      await expect(host.page.getByTestId("seat")).toHaveCount(1);
      await expect(host.page.getByTestId("seat")).toContainText(guest.name);
      await expect(guest.page.getByTestId("seat")).toContainText(host.name);
    });

    const final = await test.step("play the whole deal, every move live", () => playDeal(players, room.code));

    await test.step("both see the end of the round", async () => {
      for (const p of players) {
        await expect(p.page.getByTestId("finished-panel")).toContainText(resultHeadline(final), { timeout: REALTIME_MS });
      }
      await expect(guest.page.getByTestId("new-round")).toHaveCount(0);
    });

    await test.step("host starts a new round, the guest follows live", async () => {
      await host.page.getByTestId("new-round").click();
      for (const p of players) {
        await expect(p.page.getByTestId("room")).toHaveAttribute("data-round", "2", { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("my-hand").getByRole("button")).toHaveCount(4);
      }
    });

    await test.step("the guest leaves mid-round: the host sees it cancelled, then leaves too", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("finished-panel")).toContainText(`Runda s-a anulat: ${guest.name} a plecat.`, {
        timeout: REALTIME_MS,
      });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
