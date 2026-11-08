import "server-only";
import { MAX_PLAYERS, MIN_PLAYERS, newDeal, roundLeader, seatOrder, teamProblem } from "@/lib/septica";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { fail } from "./http";
import { listPlayers, listSpectators, saveRoom } from "./room";

/** Deals round `round` to everyone in the room (host only, checked by the caller). */
export async function startDeal(room: RoomRow, round: number, requireReady: boolean): Promise<void> {
  const players = await listPlayers(room.id);
  if (players.length < MIN_PLAYERS) fail(409, `Ai nevoie de cel puțin ${MIN_PLAYERS} jucători.`);
  if (players.length > MAX_PLAYERS) fail(409, `Maxim ${MAX_PLAYERS} jucători.`);
  if (requireReady) {
    const notReady = players.filter((p) => !p.ready);
    if (notReady.length > 0) fail(409, `Nu sunt toți gata: ${notReady.map((p) => p.nickname).join(", ")}.`);
  }
  const problem = teamProblem(players, room.teams);
  if (problem) fail(409, problem);

  const order = seatOrder(players, room.teams);
  const deal = newDeal(order, roundLeader(order, round), room.teams);
  await saveRoom(room, { status: "playing", round, deal, result: null });
  const { error } = await db().from(T.players).update({ kick_requested_at: null }).eq("room_id", room.id);
  if (error) throw error;
  await notifyRoom(room.id, "deal_started");
}

/** Alternating teams in join order, for players without one (teams switched on / player joined). */
export async function balanceTeams(roomId: string): Promise<void> {
  const players = await listPlayers(roomId);
  const count = [players.filter((p) => p.team === 0).length, players.filter((p) => p.team === 1).length];
  for (const p of players) {
    if (p.team === 0 || p.team === 1) continue;
    const team = count[0] <= count[1] ? 0 : 1;
    count[team] += 1;
    const { error } = await db().from(T.players).update({ team }).eq("id", p.id);
    if (error) throw error;
  }
}

/**
 * Spectators who queued ("Intră la runda următoare") become players, in queue order, while seats are free.
 * The rest stay spectators. Called before a new round / when going back to the lobby.
 */
export async function promoteQueued(room: RoomRow): Promise<number> {
  const players = await listPlayers(room.id);
  const queued = (await listSpectators(room.id)).filter((s) => s.queued_at !== null);
  let seat = players.reduce((m, p) => Math.max(m, p.seat), -1) + 1;
  let count = players.length;
  let promoted = 0;
  for (const s of queued) {
    if (count >= MAX_PLAYERS) break;
    const { error } = await db()
      .from(T.players)
      .update({ role: "player", queued_at: null, seat: seat++, ready: false, team: null, wins: 0 })
      .eq("id", s.id)
      .eq("role", "spectator");
    if (error) throw error;
    count++;
    promoted++;
  }
  if (promoted > 0 && room.teams) await balanceTeams(room.id);
  return promoted;
}
