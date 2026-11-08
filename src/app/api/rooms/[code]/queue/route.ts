import { MAX_PLAYERS } from "@/lib/septica";
import { notifyRoom } from "@/lib/server/broadcast";
import { balanceTeams } from "@/lib/server/deal";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { listPlayers, requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - spectator toggles "Intră la runda următoare".
// Queued spectators become players (in queue order, while seats are free) when the next round starts.
// In the lobby there is nothing to wait for: a free seat is taken right away.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code, { allowSpectator: true });
    if (player.role !== "spectator") fail(409, "Ești deja jucător.");

    if (room.status === "lobby") {
      const players = await listPlayers(room.id);
      if (players.length >= MAX_PLAYERS) fail(409, `Camera e plină (maxim ${MAX_PLAYERS} jucători).`);
      const seat = players.reduce((m, p) => Math.max(m, p.seat), -1) + 1;
      const { error } = await db()
        .from(T.players)
        .update({ role: "player", queued_at: null, seat, ready: false, team: null, wins: 0 })
        .eq("id", player.id)
        .eq("role", "spectator");
      if (error) throw error;
      if (room.teams) await balanceTeams(room.id);
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_joined");
      return { ok: true, joined: true };
    }

    const queued = player.queued_at === null ? new Date().toISOString() : null;
    const { error } = await db().from(T.players).update({ queued_at: queued }).eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue_changed");
    return { ok: true, queued: queued !== null };
  });
}
