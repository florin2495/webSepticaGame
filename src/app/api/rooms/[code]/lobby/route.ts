import { promoteQueued } from "@/lib/server/deal";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, saveRoom, stateAfterAction } from "@/lib/server/room";

// POST /api/rooms/[code]/lobby - host, after a round: back to the lobby (others can join, teams can change).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/lobby">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await saveRoom(room, { status: "lobby", round: room.round + 1, deal: null, result: null });
    const { error } = await db().from(T.players).update({ ready: false, kick_requested_at: null }).eq("room_id", room.id);
    if (error) throw error;
    await promoteQueued(room);
    await notifyRoom(room.id, "back_to_lobby", room.version + 1, player.id);
    return await stateAfterAction(room, player);
  });
}
