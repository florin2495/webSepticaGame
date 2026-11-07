import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Deal } from "@/lib/septica";
import type { RoundResult } from "@/lib/types";

/**
 * Table names. The Supabase project is shared by several mini-games (the hub),
 * so every Șeptică table carries the septica_ prefix.
 */
export const T = {
  rooms: "septica_rooms",
  players: "septica_players",
} as const;

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  teams: boolean;
  status: "lobby" | "playing" | "finished";
  round: number;
  host_player_id: string | null;
  deal: Deal | null;
  result: RoundResult | null;
  version: number;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, teams, status, round, host_player_id, deal, result, version, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  ready: boolean;
  team: number | null;
  wins: number;
  joined_at: string;
  /** Pending host kick during a game (null = none). Needs migration 001. */
  kick_requested_at: string | null;
  /** Presence stamp, touched by requireMember. Needs migration 002_reconnect.sql. */
  last_seen_at: string;
}

/** Never add token_hash / device_hash here: these rows feed the public state. */
export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, ready, team, wins, joined_at, kick_requested_at, last_seen_at";
