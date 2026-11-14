import "server-only";
import { db } from "./db";

/**
 * Hub leaderboard (contract C). Tables belong to the hub (hub_leaderboard, hub_leaderboard_rounds); this
 * game only writes them, with the service key, like hub_feedback. Needs the hub's leaderboard migration.
 */
// LEADERBOARD_GAME lets local dev/tests write to a throwaway game instead of the real one.
const GAME = process.env.LEADERBOARD_GAME?.trim() || "septica";

/** One person = one lowercase, trimmed nickname (there are no accounts). */
export const playerKey = (nickname: string) => nickname.trim().toLowerCase().slice(0, 40);

interface Entry {
  nickname: string;
  won: boolean;
}

/**
 * Counts a finished round once: +1 games for everybody, +1 wins for the winners (all members of the winning
 * side). Idempotent per (room, round) through hub_leaderboard_rounds. Best effort: a leaderboard problem
 * must never break the game, so errors are logged and swallowed.
 */
export async function reportRound(roomCode: string, roundNo: number, entries: Entry[]): Promise<void> {
  try {
    const { error: claimError } = await db()
      .from("hub_leaderboard_rounds")
      .insert({ game: GAME, room_code: roomCode, round_no: roundNo });
    if (claimError) {
      if (claimError.code === "23505") return; // already counted
      throw claimError;
    }
    for (const e of entries) {
      const key = playerKey(e.nickname);
      if (!key) continue;
      const { data, error } = await db()
        .from("hub_leaderboard")
        .select("wins, games")
        .eq("game", GAME)
        .eq("player_key", key)
        .maybeSingle();
      if (error) throw error;
      const { error: upsertError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: key,
            display_name: e.nickname.trim().slice(0, 40),
            wins: (data?.wins ?? 0) + (e.won ? 1 : 0),
            games: (data?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upsertError) throw upsertError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
