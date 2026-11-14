// Scenario 2: someone opens the invite link of a running deal. They become a spectator (no hand, no player
// buttons), the players see them live, they see every move live, they queue for the next round ("în coadă" seen by
// the players), see the end of the round, and the host's "Rundă nouă" seats them as a player. Desktop Chromium only:
// it checks game logic and Realtime, the device does not matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playDeal, readyAndStart, REALTIME_MS, resultHeadline, withPlayers } from "./helpers";

test("a late joiner watches as a spectator and plays from the next round", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;

    await test.step("two players start a deal", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await readyAndStart([host, guest]);
    });

    await test.step("a third person joins mid-deal and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-status")).toContainText("Privești runda");
      await expect(sp.getByTestId("trick-table")).toBeVisible();
      for (const id of ["my-hand", "ready", "let-go", "new-round"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("spectator-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      }
    });

    await test.step("the spectator queues for the next round, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toHaveAttribute("data-queued", "true");
      await expect(host.page.getByTestId("spectator-list")).toContainText("în coadă", { timeout: REALTIME_MS });
    });

    const final = await test.step("the deal is played; the spectator sees every move live", () =>
      playDeal([host, guest], room.code, [spectator]),
    );

    await test.step("the spectator sees the end of the round", async () => {
      await expect(spectator.page.getByTestId("finished-panel")).toContainText(resultHeadline(final), { timeout: REALTIME_MS });
    });

    await test.step("new round: the queued spectator becomes a player", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("my-hand").getByRole("button")).toHaveCount(4, { timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("spectator-status")).toHaveCount(0);
      await expect(host.page.getByTestId("seat")).toHaveCount(2);
      await expect(host.page.getByTestId("spectator-list")).toHaveCount(0);
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, guest, host]);
      room.closed = true;
    });
  });
});
