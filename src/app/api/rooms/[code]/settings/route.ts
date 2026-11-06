import { notifyRoom } from "@/lib/server/broadcast";
import { balanceTeams } from "@/lib/server/deal";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/settings { teams: boolean } - host, lobby only. Resets everyone's "ready".
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    if (typeof body.teams !== "boolean") fail(400, "Setare invalidă.");

    await saveRoom(room, { teams: body.teams });
    const { error } = await db()
      .from(T.players)
      .update(body.teams ? { ready: false } : { ready: false, team: null })
      .eq("room_id", room.id);
    if (error) throw error;
    if (body.teams) await balanceTeams(room.id);
    await notifyRoom(room.id, "settings_changed");
    return { ok: true };
  });
}
