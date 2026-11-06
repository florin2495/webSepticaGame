import { letGo } from "@/lib/septica";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/let-go - the trick leader, after being cut, lets the trick go.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/let-go">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    await applyMove(room, (deal) => letGo(deal, player.id), "trick_let_go");
    return { ok: true };
  });
}
