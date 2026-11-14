import { connection } from "next/server";
import { NICKNAME_MAX } from "@/lib/septica";
import { hashDeviceId, hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupExpiredRooms } from "@/lib/server/room";
import type { RoomListItem } from "@/lib/types";

// GET /api/rooms - public list of all live rooms (lobby, in-game and finished; idle ones are cleaned up first).
// Joining a room that is not in the lobby makes you a spectator.
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await cleanupExpiredRooms();
    const { data, error } = await db()
      .from(T.rooms)
      .select("code, name, teams, status, password_hash, last_activity_at, players:septica_players!septica_players_room_id_fkey(role)")
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? []).map((r) => {
      const members = (r.players ?? []) as unknown as { role: "player" | "spectator" }[];
      const seated = members.filter((m) => m.role === "player").length;
      return {
        code: r.code,
        name: r.name,
        teams: r.teams,
        hasPassword: r.password_hash !== null,
        status: r.status,
        players: seated,
        spectators: members.length - seated,
      };
    });
    return { rooms };
  });
}

// POST /api/rooms { name, nickname, password?, teams?, deviceId? } - create a room and its host player.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const teams = body.teams === true;

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from(T.rooms)
        .insert({ code: newRoomCode(), name, password_hash: passwordHash, teams })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from(T.players)
      .insert({
        room_id: room.id,
        nickname,
        token_hash: hashToken(token),
        device_hash: hashDeviceId(body.deviceId),
        is_host: true,
        team: teams ? 0 : null,
      })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db().from(T.rooms).update({ host_player_id: player.id }).eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
