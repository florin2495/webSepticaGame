import { isCard, playCard } from "@/lib/septica";
import { fail, handle, readJson } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/play { card } - play a card from your hand on your turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/play">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const body = await readJson(req);
    if (!isCard(body.card)) fail(400, "Carte invalidă.");
    const card = body.card;
    await applyMove(room, (deal) => playCard(deal, player.id, card), "card_played");
    return { ok: true };
  });
}
