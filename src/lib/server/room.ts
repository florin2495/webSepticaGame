import "server-only";
import {
  canLetGo,
  type Deal,
  isDealOver,
  isRoomAbandoned,
  isRoomExpired,
  isTestRoom,
  legalCards,
  ROOM_ABANDONED_MS,
  ROOM_IDLE_MINUTES,
  RuleError,
  sides,
  trickHolder,
  winningSides,
} from "@/lib/septica";
import type { GameView, PublicPlayer, RoomState, RoundResult } from "@/lib/types";
import { notifyRoom } from "./broadcast";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, type PlayerRow, ROOM_COLUMNS, type RoomRow, T } from "./db";
import { fail } from "./http";
import { reportRound } from "./leaderboard";
import { enforceExpiredKicks } from "./membership";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";

const GONE = "Camera nu mai există (a fost închisă după inactivitate).";

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every lobby/finished room idle for longer than ROOM_IDLE_MINUTES. */
export async function cleanupExpiredRooms(): Promise<void> {
  const cutoff = new Date(Date.now() - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const { error } = await db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", cutoff);
  if (error) console.error("cleanup failed", error);
}

/**
 * Deletes rooms in ANY status (also "playing") with no activity for ROOM_ABANDONED_MS and no player or
 * spectator (both are septica_players rows) seen within it (see isRoomAbandoned). Players cascade.
 * Best effort: a failure is logged, never thrown.
 */
export async function cleanupAbandonedRooms(): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - ROOM_ABANDONED_MS).toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .select("id, last_activity_at, players:septica_players!septica_players_room_id_fkey(last_seen_at)")
    .lt("last_activity_at", cutoff)
    .limit(200);
  if (error) {
    console.error("abandoned cleanup (select) failed", error);
    return;
  }
  type Seen = { last_seen_at: string | null }[] | null;
  const ids = (data ?? [])
    .filter((r) => {
      const seen = ((r.players as Seen) ?? []).map((m) => m.last_seen_at);
      return isRoomAbandoned(r.last_activity_at as string, seen, now);
    })
    .map((r) => r.id as string);
  if (ids.length === 0) return;
  // Re-check the activity cutoff in the delete itself, so a room touched meanwhile survives.
  const { error: delError } = await db().from(T.rooms).delete().in("id", ids).lt("last_activity_at", cutoff);
  if (delError) console.error("abandoned cleanup (delete) failed", delError);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(
  req: Request,
  code: string,
  opts: { allowSpectator?: boolean } = {},
): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  let room = await getRoomByCode(code);
  // Lazy enforcement of expired pending kicks (no timers on serverless); may remove the caller -> 401 below.
  if (await enforceExpiredKicks(room)) room = await getRoomByCode(code);
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  // Spectators only look (state), queue for the next round and leave; every other action is for players.
  if (player.role === "spectator" && !opts.allowSpectator) fail(403, "Ești spectator: nu poți face asta.");
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Jocul nu a început încă.",
      playing: "Jocul este în desfășurare.",
      finished: "Runda s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

/** Seated players in play order (saved seat, then join time). Spectators are not included. */
export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .eq("role", "player")
    .order("seat", { ascending: true })
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Spectators, queued ones first in queue order, then the others by join time. */
export async function listSpectators(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .eq("role", "spectator")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as PlayerRow[];
  const queued = rows.filter((r) => r.queued_at !== null).sort((a, b) => Date.parse(a.queued_at!) - Date.parse(b.queued_at!));
  return [...queued, ...rows.filter((r) => r.queued_at === null)];
}

/**
 * Writes room changes only if nobody else changed the room since it was read (version check).
 * Every write that touches the deal goes through here.
 */
export async function saveRoom(room: RoomRow, patch: Partial<Omit<RoomRow, "id" | "version">>): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .update({ ...patch, version: room.version + 1, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) fail(409, "Altcineva a mutat între timp. Mai încearcă o dată.");
}

/** Outcome of a finished deal. */
export function dealResult(deal: Deal): RoundResult {
  const all = sides(deal);
  const best = winningSides(all);
  return { sides: all, winners: best.map((s) => s.index) };
}

/**
 * Applies a move to the running deal and saves it. When the deal is over the round finishes:
 * the result is stored and the winners' (single winning side only - a draw gives nothing) wins go up.
 */
export async function applyMove(
  room: RoomRow,
  move: (deal: Deal) => Deal,
  reason: string,
  viewer: PlayerRow,
): Promise<RoomState> {
  if (room.status !== "playing" || !room.deal) fail(409, "Nu se joacă acum.");
  let next: Deal;
  try {
    next = move(room.deal);
  } catch (err) {
    if (err instanceof RuleError) fail(409, err.message);
    throw err;
  }
  const version = room.version + 1;
  if (!isDealOver(next)) {
    await saveRoom(room, { deal: next });
    // The broadcast and the caller's fresh state go out together; the caller applies the returned state directly.
    const [state] = await Promise.all([buildState({ ...room, deal: next, version }, viewer), notifyRoom(room.id, reason, version, viewer.id)]);
    return state;
  }
  const result = dealResult(next);
  await saveRoom(room, { deal: next, status: "finished", result });
  const players = await listPlayers(room.id);
  const winners = result.winners.length === 1 ? result.sides[result.winners[0]].members : [];
  for (const p of players.filter((x) => winners.includes(x.id))) {
    const { error } = await db().from(T.players).update({ wins: p.wins + 1 }).eq("id", p.id);
    if (error) throw error;
  }
  // Hub leaderboard: everybody who played gets a game, the winning side a win (a draw has no winner).
  // Test rooms (e2e-test-*, run against the production DB) never count.
  if (!isTestRoom(room.name)) {
    await reportRound(
      room.code,
      room.round,
      players.filter((x) => next.order.includes(x.id)).map((x) => ({ nickname: x.nickname, won: winners.includes(x.id) })),
    );
  }
  const [state] = await Promise.all([
    buildState({ ...room, deal: next, status: "finished", result, version }, viewer),
    notifyRoom(room.id, "round_finished", version, viewer.id),
  ]);
  return state;
}

/** Fresh state for the caller right after an action, so the client needs no follow-up /state request. */
export async function stateAfterAction(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  return buildState(await getRoomByCode(room.code), me);
}

const toPublic = (p: PlayerRow, now: number): PublicPlayer => ({
  id: p.id,
  nickname: p.nickname,
  isHost: p.is_host,
  ready: p.ready,
  team: p.team,
  wins: p.wins,
  kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
  connected: isConnected(p.last_seen_at, now),
  role: p.role,
  queued: p.queued_at !== null,
});

function gameView(deal: Deal, meId: string, finished: boolean): GameView {
  return {
    order: deal.order,
    teams: deal.teams,
    leader: deal.leader,
    turn: finished ? null : deal.turn,
    phase: deal.phase,
    trick: deal.trick,
    holder: trickHolder(deal.trick, deal.order.length),
    hand: deal.hands[meId] ?? [],
    legal: finished || !deal.order.includes(meId) ? [] : legalCards(deal, meId),
    canLetGo: !finished && deal.order.includes(meId) && canLetGo(deal, meId),
    handCounts: Object.fromEntries(deal.order.map((id) => [id, deal.hands[id]?.length ?? 0])),
    stockCount: deal.stock.length,
    sides: sides(deal),
    lastTrick: deal.lastTrick,
    tricksPlayed: deal.tricksPlayed,
  };
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const now = Date.now();
  const [players, spectators] = await Promise.all([listPlayers(room.id), listSpectators(room.id)]);
  const deal = room.status === "lobby" ? null : room.deal;

  // Seat order. While a deal runs it is the deal's order; between rounds it is the (re-orderable) saved seats.
  let ordered = players;
  if (deal && room.status === "playing") {
    const pos = new Map(deal.order.map((id, i) => [id, i]));
    ordered = [...players].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      teams: room.teams,
      status: room.status,
      round: room.round,
      version: room.version,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
    },
    players: ordered.map((p) => toPublic(p, now)),
    spectators: spectators.map((p) => toPublic(p, now)),
    me: toPublic(me, now),
    game: deal ? gameView(deal, me.id, room.status !== "playing") : null,
    result: room.status === "finished" ? room.result : null,
  };
}
