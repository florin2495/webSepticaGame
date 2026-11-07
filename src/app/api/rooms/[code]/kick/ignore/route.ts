import { isKickExpired } from "@/lib/kick";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/kick/ignore - the kicked player (own token) refuses a pending kick and stays.
// requireMember already removed everyone whose grace ran out (the caller then gets 401), so the 409 is a safety net.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick/ignore">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.kick_requested_at === null) return { ok: true };
    if (isKickExpired(player.kick_requested_at, Date.now())) fail(409, "Prea târziu, ai fost scos.");

    const { data, error } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", player.id)
      .not("kick_requested_at", "is", null)
      .select("id");
    if (error) throw error;
    if (data && data.length > 0) await notifyRoom(room.id, "kick_ignored");
    return { ok: true };
  });
}
