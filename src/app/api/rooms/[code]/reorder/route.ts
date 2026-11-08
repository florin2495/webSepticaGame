import { isPermutation } from "@/lib/septica";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, lobby or between rounds.
// `order` must list every seated player once; it becomes the play order (first = starts round 1).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby", "finished");
    const body = await readJson(req);
    const players = await listPlayers(room.id);
    const ids = players.map((p) => p.id);
    if (!isPermutation(body.order, ids)) fail(400, "Ordinea trebuie să conțină toți jucătorii, o singură dată.");
    const order = body.order as string[];
    for (let i = 0; i < order.length; i++) {
      const { error } = await db().from(T.players).update({ seat: i }).eq("id", order[i]).eq("room_id", room.id);
      if (error) throw error;
    }
    await touchRoom(room.id);
    await notifyRoom(room.id, "order_changed");
    return { ok: true };
  });
}
