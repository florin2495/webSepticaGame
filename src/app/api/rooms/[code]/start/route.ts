import { startDeal } from "@/lib/server/deal";
import { handle } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, stateAfterAction } from "@/lib/server/room";

// POST /api/rooms/[code]/start - host only, everyone ready. Fixes the seats and deals.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    await startDeal(room, room.round, true, player.id);
    return await stateAfterAction(room, player);
  });
}
