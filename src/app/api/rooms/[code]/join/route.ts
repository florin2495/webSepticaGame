import { enforceExpiredKicks } from "@/lib/server/membership";
import { MAX_PLAYERS, NICKNAME_MAX } from "@/lib/septica";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { balanceTeams } from "@/lib/server/deal";
import { db, MAX_SPECTATORS, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, touchRoom } from "@/lib/server/room";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";

interface SeatRow {
  id: string;
  role: "player" | "spectator";
  seat: number;
  nickname: string;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, deviceId? }
// A nickname that already has a seat in the room reclaims that seat (same player id, new token; team, ready
// and wins kept) when the request comes from the same device or the seat has been disconnected for 45 s -
// in the lobby, mid-deal and after a deal alike.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    // Enforce host kicks whose 10 s are over first, so a reclaim cannot undo an expired kick.
    let room = await getRoomByCode(code);
    if (await enforceExpiredKicks(room)) room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: seats, error: seatsError } = await db()
      .from(T.players)
      .select("id, role, seat, nickname, token_hash, device_hash, last_seen_at")
      .eq("room_id", room.id);
    if (seatsError) throw seatsError;
    const rows = (seats ?? []) as SeatRow[];

    const existing = rows.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      // A pending kick is dropped (the player is back); team / ready / wins stay with the seat.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token };
    }

    const seated = rows.filter((p) => p.role === "player");
    // A room that already started: the newcomer watches (max 16) and can queue for the next round.
    const spectate = room.status !== "lobby";
    if (spectate) {
      if (rows.length - seated.length >= MAX_SPECTATORS) {
        fail(409, `Camera are deja ${MAX_SPECTATORS} spectatori (maximul). Încearcă mai târziu.`);
      }
    } else if (seated.length >= MAX_PLAYERS) {
      fail(409, `Camera e plină (maxim ${MAX_PLAYERS} jucători).`);
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(T.players)
      .insert({
        room_id: room.id,
        nickname,
        token_hash: hashToken(token),
        device_hash: deviceHash,
        role: spectate ? "spectator" : "player",
        seat: spectate ? 0 : seated.reduce((m, p) => Math.max(m, p.seat), -1) + 1,
      })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    if (room.teams && !spectate) await balanceTeams(room.id);
    await touchRoom(room.id);
    await notifyRoom(room.id, spectate ? "spectator_joined" : "player_joined");
    return { code: room.code, playerId: data.id, token };
  });
}
