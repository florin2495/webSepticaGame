import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/team { team: 0 | 1 } - pick your team in a team room (lobby). Resets your "ready".
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/team">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "lobby");
    if (!room.teams) fail(409, "Camera nu se joacă pe echipe.");
    const body = await readJson(req);
    if (body.team !== 0 && body.team !== 1) fail(400, "Echipă invalidă.");
    const { error } = await db().from(T.players).update({ team: body.team, ready: false }).eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "team_changed");
    return { ok: true };
  });
}
