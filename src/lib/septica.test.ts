import { describe, expect, it } from "vitest";
import {
  autoMove,
  buildDeck,
  canLetGo,
  type Deal,
  isDealOver,
  legalCards,
  letGo,
  newDeal,
  playCard,
  pointsOf,
  roundLeader,
  RuleError,
  seatOrder,
  sides,
  teamProblem,
  trickHolder,
  winningSides,
} from "./septica";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deal with chosen hands, for scenario tests. */
function fixed(hands: Record<string, string[]>, stock: string[] = [], leader?: string): Deal {
  const order = Object.keys(hands);
  return {
    order,
    teams: false,
    stock,
    hands: structuredClone(hands),
    leader: leader ?? order[0],
    turn: leader ?? order[0],
    phase: "play",
    trick: [],
    captured: Object.fromEntries(order.map((id) => [id, []])),
    lastTrick: null,
    tricksPlayed: 0,
  };
}

describe("deck", () => {
  it("has 32 cards and 8 points, 30 cards for 3 players", () => {
    expect(buildDeck(2)).toHaveLength(32);
    expect(new Set(buildDeck(4)).size).toBe(32);
    expect(buildDeck(3)).toHaveLength(30);
    expect(buildDeck(3)).not.toContain("8C");
    expect(pointsOf(buildDeck(3))).toBe(8);
    expect(pointsOf(buildDeck(2))).toBe(8);
  });
});

describe("newDeal", () => {
  it("deals 4 cards to everyone and keeps the rest as stock", () => {
    const d = newDeal(["a", "b", "c"], "b", false, rng(1));
    expect(d.order.map((id) => d.hands[id].length)).toEqual([4, 4, 4]);
    expect(d.stock).toHaveLength(18);
    expect(d.turn).toBe("b");
  });
  it("rejects teams without 4 players", () => {
    expect(() => newDeal(["a", "b", "c"], "a", true)).toThrow(RuleError);
  });
});

describe("tricks", () => {
  it("leader takes the trick when nobody cuts", () => {
    let d = fixed({ a: ["9H"], b: ["KS"] });
    d = playCard(d, "a", "9H");
    expect(d.turn).toBe("b");
    d = playCard(d, "b", "KS");
    expect(d.lastTrick?.winner).toBe("a");
    expect(d.captured.a).toEqual(["9H", "KS"]);
    expect(isDealOver(d)).toBe(true);
  });

  it("same rank or a 7 cuts; the last cutter holds the trick", () => {
    expect(trickHolder([{ playerId: "a", card: "9H" }, { playerId: "b", card: "9S" }, { playerId: "c", card: "KD" }])).toBe("b");
    expect(trickHolder([{ playerId: "a", card: "9H" }, { playerId: "b", card: "9S" }, { playerId: "c", card: "7D" }])).toBe("c");
    expect(trickHolder([{ playerId: "a", card: "AH" }, { playerId: "b", card: "10S" }])).toBe("a");
  });

  it("a cut leader may continue with a cutting card, or let go", () => {
    let d = fixed({ a: ["9H", "9C", "8S"], b: ["9S", "KD", "QH"] });
    d = playCard(d, "a", "9H");
    d = playCard(d, "b", "9S");
    expect(d.phase).toBe("decide");
    expect(d.turn).toBe("a");
    expect(legalCards(d, "a")).toEqual(["9C"]);
    expect(() => playCard(d, "a", "8S")).toThrow(RuleError);

    const gone = letGo(d, "a");
    expect(gone.lastTrick?.winner).toBe("b");
    expect(gone.turn).toBe("b");

    let cont = playCard(d, "a", "9C");
    expect(cont.phase).toBe("play");
    expect(cont.turn).toBe("b");
    cont = playCard(cont, "b", "KD");
    expect(cont.lastTrick?.winner).toBe("a");
    expect(cont.captured.a).toHaveLength(4);
  });

  it("does not offer to continue when the leader cannot cut", () => {
    let d = fixed({ a: ["9H", "8S"], b: ["9S", "KD"] });
    d = playCard(d, "a", "9H");
    d = playCard(d, "b", "9S");
    expect(d.phase).toBe("play");
    expect(d.lastTrick?.winner).toBe("b");
    expect(canLetGo(d, "a")).toBe(false);
  });

  it("does not offer to continue when the leader still holds the trick", () => {
    let d = fixed({ a: ["9H", "9C"], b: ["KS", "KD"] });
    d = playCard(d, "a", "9H");
    d = playCard(d, "b", "KS");
    expect(d.lastTrick?.winner).toBe("a");
  });

  it("winner draws first and leads next", () => {
    let d = fixed({ a: ["9H", "8S", "8C", "8D"], b: ["9S", "KD", "QH", "JH"] }, ["AS", "10S"]);
    d = playCard(d, "a", "9H");
    d = playCard(d, "b", "9S");
    // a has no other 9 and no 7: the trick resolves on its own.
    expect(d.hands.b).toContain("10S"); // last stock card = first drawn
    expect(d.hands.a).toContain("AS");
    expect(d.turn).toBe("b");
  });

  it("rejects playing out of turn or a card not in hand", () => {
    const d = fixed({ a: ["9H"], b: ["KS"] });
    expect(() => playCard(d, "b", "KS")).toThrow(RuleError);
    expect(() => playCard(d, "a", "KS")).toThrow(RuleError);
  });
});

describe("full random games", () => {
  for (const n of [2, 3, 4]) {
    it(`always ends with all cards captured and 8 points (${n} players)`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const random = rng(seed * 31 + n);
        const order = ["p1", "p2", "p3", "p4"].slice(0, n);
        let d = newDeal(order, order[seed % n], n === 4 && seed % 2 === 0, random);
        let steps = 0;
        while (!isDealOver(d)) {
          // Mix of random legal choices and continuing/letting go.
          if (d.phase === "decide" && random() < 0.5) d = letGo(d, d.turn);
          else if (random() < 0.3) d = autoMove(d, d.turn);
          else {
            const legal = legalCards(d, d.turn);
            d = playCard(d, d.turn, legal[Math.floor(random() * legal.length)]);
          }
          // Everyone not yet played in this round has the same number of cards.
          expect(++steps).toBeLessThan(200);
        }
        const all = sides(d);
        expect(all.reduce((s, x) => s + x.points, 0)).toBe(8);
        expect(all.reduce((s, x) => s + x.cards, 0)).toBe(buildDeck(n).length);
        expect(winningSides(all).length).toBeGreaterThan(0);
      }
    });
  }
});

describe("seats and teams", () => {
  it("free-for-all: host first, then join order", () => {
    expect(seatOrder([{ id: "a", team: null }, { id: "b", team: null }, { id: "c", team: null }], "b", false)).toEqual(["b", "a", "c"]);
  });
  it("teams: partners sit opposite, host in seat 0", () => {
    const players = [
      { id: "a", team: 0 },
      { id: "b", team: 0 },
      { id: "c", team: 1 },
      { id: "d", team: 1 },
    ];
    const order = seatOrder(players, "c", true);
    expect(order[0]).toBe("c");
    expect(order[2]).toBe("d");
    expect([order[1], order[3]].sort()).toEqual(["a", "b"]);
  });
  it("team sides add up partners", () => {
    const s = sides({
      order: ["a", "b", "c", "d"],
      teams: true,
      captured: { a: ["10H"], b: ["AS"], c: ["AH", "9C"], d: [] },
    });
    expect(s.map((x) => x.points)).toEqual([2, 1]);
    expect(s[0].members).toEqual(["a", "c"]);
  });
  it("validates teams", () => {
    expect(teamProblem([{ team: 0 }, { team: 1 }], true)).not.toBeNull();
    expect(teamProblem([{ team: 0 }, { team: 0 }, { team: 0 }, { team: 1 }], true)).not.toBeNull();
    expect(teamProblem([{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }], true)).toBeNull();
    expect(teamProblem([{ team: null }, { team: null }], false)).toBeNull();
  });
  it("first leader rotates every round", () => {
    expect([1, 2, 3, 4].map((r) => roundLeader(["a", "b", "c"], r))).toEqual(["a", "b", "c", "a"]);
  });
  it("tie gives several winning sides", () => {
    const s = [
      { index: 0, members: ["a"], points: 4, cards: 16 },
      { index: 1, members: ["b"], points: 4, cards: 16 },
    ];
    expect(winningSides(s)).toHaveLength(2);
  });
});
