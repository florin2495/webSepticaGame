import { promoteQueued, startDeal } from "@/lib/server/deal";
import { handle } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, stateAfterAction } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host, after a round: deal again with the same players.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await promoteQueued(room);
    await startDeal(room, room.round + 1, false, player.id);
    return await stateAfterAction(room, player);
  });
}
