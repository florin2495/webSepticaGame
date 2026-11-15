// Pure Șeptică rules - shared by server and client, no I/O.
//
// Rules implemented (classic Romanian Șeptică):
//  - 32 cards (7, 8, 9, 10, J, Q, K, A in 4 suits). With 3 players two 8s are removed (30 cards).
//  - Everyone holds 4 cards. The trick leader plays any card; then everyone, in seat order, plays any card.
//  - A card "cuts" (taie) when it has the same rank as the first card of the trick, or is a 7 (wild).
//  - After every full round of the trick, if someone else holds the trick, the leader may continue with
//    another cutting card (then everyone plays again) or let it go. The last cutter takes all the cards.
//    If nobody cut, the leader takes them.
//  - Then everyone draws back up to 4 (winner first), and the winner leads the next trick.
//  - 10s and Aces are worth 1 point each (8 in total). Most points wins the round; 4-4 is a draw.
//  - With 4 players the room can play in teams: seats 1 & 3 vs 2 & 4 (partners sit opposite).

export const HAND_SIZE = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const TOTAL_POINTS = 8;
export const NICKNAME_MAX = 12;

/**
 * Rooms made by the automated tests (scripts/e2e.mjs, tests/ui) are named like this. They run against the
 * production DB, so their rounds are never reported to the hub leaderboard.
 */
export const TEST_ROOM_PREFIX = "e2e-test-";
export const isTestRoom = (name: string) => name.startsWith(TEST_ROOM_PREFIX);

/**
 * Lobby/finished rooms are closed (deleted) after this long without activity. Every open room page
 * polls /state, which refreshes the timer (see PRESENCE_TOUCH_MS), so a room only closes once nobody
 * has it open.
 */
export const ROOM_IDLE_MINUTES = 10;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

/** "2 minute" / "10 minute" / "60 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  if (status !== "lobby" && status !== "finished") return false;
  return now - new Date(lastActivityAt).getTime() > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * player or spectator has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** A card is rank + suit, e.g. "10H", "7S", "AD". */
export type Card = string;

export const rankOf = (card: Card) => card.slice(0, -1) as Rank;
export const suitOf = (card: Card) => card.slice(-1) as Suit;
export const isPointCard = (card: Card) => rankOf(card) === "10" || rankOf(card) === "A";
export const pointsOf = (cards: Card[]) => cards.filter(isPointCard).length;

export function isCard(value: unknown): value is Card {
  if (typeof value !== "string") return false;
  return (RANKS as readonly string[]).includes(value.slice(0, -1)) && (SUITS as readonly string[]).includes(value.slice(-1));
}

/** Full deck for `players` players: 32 cards, or 30 for 3 players (8♣ and 8♦ removed). */
export function buildDeck(players: number): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`);
  return players === 3 ? deck.filter((c) => c !== "8C" && c !== "8D") : deck;
}

/** Fisher-Yates. `random` is injectable for tests. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Play {
  playerId: string;
  card: Card;
}

export interface TrickSummary {
  plays: Play[];
  winner: string;
  points: number;
}

/** One deal (round) in progress. Stored as JSON on the room; hands never leave the server. */
export interface Deal {
  /** Seat order = play order. In team games seats 0 & 2 are team 0, 1 & 3 are team 1. */
  order: string[];
  teams: boolean;
  /** Draw pile; cards are drawn from the end. */
  stock: Card[];
  hands: Record<string, Card[]>;
  leader: string;
  /** Who must act now. */
  turn: string;
  /** "decide": a full round of the trick is down, the leader was cut and may continue or let go. */
  phase: "play" | "decide";
  trick: Play[];
  captured: Record<string, Card[]>;
  lastTrick: TrickSummary | null;
  tricksPlayed: number;
}

export class RuleError extends Error {}

export function cuts(card: Card, leadRank: Rank): boolean {
  return rankOf(card) === leadRank || rankOf(card) === "7";
}

/** Who currently holds the trick: the last player who cut, or the leader if nobody did. */
export function trickHolder(trick: Play[]): string | null {
  if (trick.length === 0) return null;
  const lead = rankOf(trick[0].card);
  let holder = trick[0].playerId;
  for (const p of trick.slice(1)) if (cuts(p.card, lead)) holder = p.playerId;
  return holder;
}

const nextSeat = (order: string[], id: string) => order[(order.indexOf(id) + 1) % order.length];

/** Starts a deal: shuffle, 4 cards each (one at a time, leader first). */
export function newDeal(order: string[], leader: string, teams: boolean, random: () => number = Math.random): Deal {
  if (order.length < MIN_PLAYERS || order.length > MAX_PLAYERS) throw new RuleError("Șeptica se joacă în 2-4 jucători.");
  if (teams && order.length !== 4) throw new RuleError("Pe echipe se joacă doar în 4.");
  if (!order.includes(leader)) throw new RuleError("Jucătorul care începe nu e la masă.");
  const stock = shuffle(buildDeck(order.length), random);
  const hands: Record<string, Card[]> = {};
  const captured: Record<string, Card[]> = {};
  for (const id of order) {
    hands[id] = [];
    captured[id] = [];
  }
  const deal: Deal = {
    order: [...order],
    teams,
    stock,
    hands,
    leader,
    turn: leader,
    phase: "play",
    trick: [],
    captured,
    lastTrick: null,
    tricksPlayed: 0,
  };
  refill(deal, leader);
  return deal;
}

/** Everyone draws back up to HAND_SIZE, one card at a time, starting with `first`. */
function refill(deal: Deal, first: string) {
  const start = deal.order.indexOf(first);
  const seats = [...deal.order.slice(start), ...deal.order.slice(0, start)];
  let drew = true;
  while (deal.stock.length > 0 && drew) {
    drew = false;
    for (const id of seats) {
      if (deal.stock.length === 0) break;
      if (deal.hands[id].length < HAND_SIZE) {
        deal.hands[id].push(deal.stock.pop()!);
        drew = true;
      }
    }
  }
}

/** Cards `playerId` may play right now (empty when it is not their turn). */
export function legalCards(deal: Deal, playerId: string): Card[] {
  if (deal.turn !== playerId || isDealOver(deal)) return [];
  const hand = deal.hands[playerId] ?? [];
  if (deal.phase === "decide") {
    const lead = rankOf(deal.trick[0].card);
    return hand.filter((c) => cuts(c, lead));
  }
  return [...hand];
}

/** The leader may let the trick go (only in the "decide" phase). */
export function canLetGo(deal: Deal, playerId: string): boolean {
  return deal.phase === "decide" && deal.turn === playerId;
}

export function isDealOver(deal: Deal): boolean {
  return deal.trick.length === 0 && deal.stock.length === 0 && deal.order.every((id) => deal.hands[id].length === 0);
}

function clone(deal: Deal): Deal {
  return structuredClone(deal);
}

/** Plays `card` for `playerId`. Returns the new deal (the input is not mutated). */
export function playCard(input: Deal, playerId: string, card: Card): Deal {
  if (isDealOver(input)) throw new RuleError("Runda s-a terminat.");
  if (input.turn !== playerId) throw new RuleError("Nu e rândul tău.");
  if (!legalCards(input, playerId).includes(card)) {
    throw new RuleError(
      input.phase === "decide"
        ? `Poți continua doar cu ${rankLabel(rankOf(input.trick[0].card))} sau cu 7.`
        : "Nu ai cartea asta.",
    );
  }
  const deal = clone(input);
  deal.hands[playerId] = deal.hands[playerId].filter((c) => c !== card);
  deal.trick.push({ playerId, card });
  deal.phase = "play";

  const n = deal.order.length;
  if (deal.trick.length % n !== 0) {
    deal.turn = nextSeat(deal.order, playerId);
    return deal;
  }
  // A full round of the trick is down.
  const holder = trickHolder(deal.trick)!;
  const lead = rankOf(deal.trick[0].card);
  if (holder !== deal.leader && deal.hands[deal.leader].some((c) => cuts(c, lead))) {
    deal.phase = "decide";
    deal.turn = deal.leader;
    return deal;
  }
  return resolveTrick(deal);
}

/** The leader lets the trick go to whoever cut last. */
export function letGo(input: Deal, playerId: string): Deal {
  if (!canLetGo(input, playerId)) throw new RuleError("Nu poți lăsa mâna acum.");
  return resolveTrick(clone(input));
}

function resolveTrick(deal: Deal): Deal {
  const winner = trickHolder(deal.trick)!;
  const cards = deal.trick.map((p) => p.card);
  deal.captured[winner].push(...cards);
  deal.lastTrick = { plays: deal.trick, winner, points: pointsOf(cards) };
  deal.trick = [];
  deal.tricksPlayed += 1;
  deal.phase = "play";
  refill(deal, winner);
  deal.leader = winner;
  deal.turn = winner;
  return deal;
}

/**
 * A move made for a player who does not respond (host's "joacă pentru el"):
 * lets the trick go when deciding, otherwise plays the least valuable card (no 10/A, no 7 if possible).
 */
export function autoMove(deal: Deal, playerId: string): Deal {
  if (canLetGo(deal, playerId)) return letGo(deal, playerId);
  const legal = legalCards(deal, playerId);
  if (legal.length === 0) throw new RuleError("Nu e rândul lui.");
  const order = ["8", "9", "J", "Q", "K", "7", "10", "A"];
  const best = [...legal].sort((a, b) => order.indexOf(rankOf(a)) - order.indexOf(rankOf(b)))[0];
  return playCard(deal, playerId, best);
}

export interface Side {
  /** Team index (0/1) in team games, seat index otherwise. */
  index: number;
  members: string[];
  points: number;
  cards: number;
}

/** Points per side: one side per player, or the two teams. */
export function sides(deal: Pick<Deal, "order" | "teams" | "captured">): Side[] {
  const groups = deal.teams
    ? [
        [deal.order[0], deal.order[2]],
        [deal.order[1], deal.order[3]],
      ]
    : deal.order.map((id) => [id]);
  return groups.map((members, index) => {
    const cards = members.flatMap((id) => deal.captured[id] ?? []);
    return { index, members, points: pointsOf(cards), cards: cards.length };
  });
}

/** Winning side(s) of a finished deal: one side, or several on a tie for the most points. */
export function winningSides(all: Side[]): Side[] {
  const best = Math.max(...all.map((s) => s.points));
  return all.filter((s) => s.points === best);
}

/**
 * Seat order for a new game; `players` is already in saved seat order (the host can reorder it).
 * Free-for-all: that order. Teams: alternate the two teams (team of the first player first), so partners sit opposite.
 */
export function seatOrder(players: { id: string; team: number | null }[], teams: boolean): string[] {
  const bySeat = players.map((p) => p.id);
  if (!teams) return bySeat;
  const first = players[0];
  const mine = players.filter((p) => p.team === first.team).map((p) => p.id);
  const theirs = players.filter((p) => p.team !== first.team).map((p) => p.id);
  return [mine[0], theirs[0], mine[1], theirs[1]];
}

/** True when `order` lists every id of `ids` exactly once. */
export function isPermutation(order: unknown, ids: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const seen = new Set<unknown>(order);
  return seen.size === ids.length && ids.every((id) => seen.has(id));
}

/**
 * New order after moving `id` one step up (-1) or down (+1). `players` is in seat order. In team rooms the
 * player swaps with the neighbour of the same team (partners sit opposite, the team is fixed by the lobby).
 * Null when it cannot move.
 */
export function movedOrder(
  players: { id: string; team: number | null }[],
  id: string,
  dir: -1 | 1,
  teams: boolean,
): string[] | null {
  const ids = players.map((p) => p.id);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const group = teams ? players.filter((p) => p.team === players[i].team) : players;
  const target = group[group.findIndex((p) => p.id === id) + dir];
  if (!target) return null;
  const j = ids.indexOf(target.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/** Round 1 is led by seat 0, then the first leader moves one seat each round. */
export function roundLeader(order: string[], round: number): string {
  const n = order.length;
  return order[(((round - 1) % n) + n) % n];
}

/** Team problem preventing a start, or null when the room may start. */
export function teamProblem(players: { team: number | null }[], teams: boolean): string | null {
  if (!teams) return null;
  if (players.length !== 4) return "Pe echipe se joacă doar în 4 jucători.";
  const a = players.filter((p) => p.team === 0).length;
  const b = players.filter((p) => p.team === 1).length;
  if (a !== 2 || b !== 2) return "Echipele trebuie să fie 2 contra 2.";
  return null;
}

const RANK_NAMES: Record<Rank, string> = {
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "J (Valet)",
  Q: "Q (Damă)",
  K: "K (Popă)",
  A: "As",
};
export const rankLabel = (r: Rank) => RANK_NAMES[r];
export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const isRed = (card: Card) => suitOf(card) === "H" || suitOf(card) === "D";
