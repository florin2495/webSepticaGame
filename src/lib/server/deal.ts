import "server-only";
import { MAX_PLAYERS, MIN_PLAYERS, newDeal, roundLeader, seatOrder, teamProblem } from "@/lib/septica";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { fail } from "./http";
import { listPlayers, saveRoom } from "./room";

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

  const order = seatOrder(players, room.host_player_id, room.teams);
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
