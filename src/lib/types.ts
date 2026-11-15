import type { Card, Play, TrickSummary } from "./septica";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  /** 0 / 1 in team rooms, null otherwise. */
  team: number | null;
  /** Rounds won in this room. */
  wins: number;
  /** Ms left to press "Ignoră" on a pending kick (0-10000), null when none. */
  kickRemainingMs: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  role: "player" | "spectator";
  /** Spectator who asked to join the next round. */
  queued: boolean;
}

export interface SideView {
  index: number;
  members: string[];
  points: number;
  cards: number;
}

/** Outcome of a deal, stored on the room. */
export interface RoundResult {
  /** Set when the deal was cut short (someone left). */
  aborted?: { nickname: string };
  sides: SideView[];
  /** Indexes of the winning sides (several = draw). Empty when aborted. */
  winners: number[];
}

/** What a member sees of the running deal. Other players' hands are only counts. */
export interface GameView {
  order: string[];
  teams: boolean;
  leader: string;
  turn: string | null;
  phase: "play" | "decide";
  trick: Play[];
  /** Who currently holds the trick. */
  holder: string | null;
  hand: Card[];
  /** Cards the caller may play right now. */
  legal: Card[];
  canLetGo: boolean;
  handCounts: Record<string, number>;
  stockCount: number;
  sides: SideView[];
  lastTrick: TrickSummary | null;
  tricksPlayed: number;
}

export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    teams: boolean;
    status: RoomStatus;
    round: number;
    /** Bumped on every deal write: lets the client drop stale / duplicate state. */
    version: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
  };
  /** Seat order while playing/finished, join order in the lobby. */
  players: PublicPlayer[];
  /** Watchers (max 16), queued ones first. Never get hands. */
  spectators: PublicPlayer[];
  me: PublicPlayer;
  game: GameView | null;
  result: RoundResult | null;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  teams: boolean;
  hasPassword: boolean;
  status: RoomStatus;
  /** Seated players. */
  players: number;
  spectators: number;
}

export interface Session {
  playerId: string;
  token: string;
}
