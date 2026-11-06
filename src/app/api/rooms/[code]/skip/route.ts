import { autoMove } from "@/lib/septica";
import { fail, handle } from "@/lib/server/http";
import { applyMove, requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/skip - host plays for a player who does not respond
// (lowest card, or lets the trick go), so the game never gets stuck.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/skip">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "playing");
    if (!room.deal) fail(409, "Nu se joacă acum.");
    const turn = room.deal.turn;
    await applyMove(room, (deal) => autoMove(deal, turn), "turn_skipped");
    return { ok: true };
  });
}
