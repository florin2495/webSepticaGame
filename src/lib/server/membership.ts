import "server-only";
import { sides } from "@/lib/septica";
import type { RoundResult } from "@/lib/types";
import { notifyRoom } from "./broadcast";
import { db, type PlayerRow, type RoomRow, T } from "./db";
import { listPlayers } from "./room";

/**
 * Removes a player from a room (used by both "leave" and the host's "kick").
 *  - last player out: the room is deleted
 *  - host removed: host passes to the next player in join order
 *  - during a deal: a card game cannot go on with a seat missing, so the round is cancelled
 *    (status finished, no winner). The host can then deal again or go back to the lobby.
 */
export async function removePlayer(room: RoomRow, player: PlayerRow, reason: string): Promise<{ roomClosed: boolean }> {
  const now = new Date().toISOString();
  const remaining = (await listPlayers(room.id)).filter((p) => p.id !== player.id);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  const newHostId = room.host_player_id === player.id ? remaining[0].id : room.host_player_id;
  const update: Record<string, unknown> = {
    host_player_id: newHostId,
    updated_at: now,
    last_activity_at: now,
    version: room.version + 1,
  };

  if (room.status === "playing" && room.deal?.order.includes(player.id)) {
    const result: RoundResult = { aborted: { nickname: player.nickname }, sides: sides(room.deal), winners: [] };
    update.status = "finished";
    update.result = result;
  }

  // Update the room first so the host never points at a deleted player.
  const { error: roomError } = await db().from(T.rooms).update(update).eq("id", room.id);
  if (roomError) throw roomError;

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from(T.players).delete().eq("id", player.id);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
