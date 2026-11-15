"use client";

import { useState } from "react";
import { PREF_CONFIRM_PLAY, useBoolPref } from "@/lib/client/prefs";
import { type Card as CardT, cutHint, cuts, movedOrder, type Play, rankLabel, rankOf, wildRanks } from "@/lib/septica";
import type { GameView, PublicPlayer, RoomState, SideView } from "@/lib/types";
import { KickBadge, OfflineBadge } from "./KickBadge";
import { CardBack, PlayingCard } from "./PlayingCard";
import { Button, Card, ErrorText } from "./ui";
import { TEAM_NAMES, TEAM_STYLES, useAction } from "./useAction";

/** Index (in the trick) of the card currently holding it. */
function holderIndex(trick: Play[], players: number): number {
  if (trick.length === 0) return -1;
  const lead = rankOf(trick[0].card);
  let idx = 0;
  trick.forEach((p, i) => {
    if (i > 0 && cuts(p.card, lead, players)) idx = i;
  });
  return idx;
}

type SeatPos = "top" | "left" | "right" | "bottom";

/** Position of the player `k` seats after the viewer (k = 0 is the viewer). */
function seatPos(k: number, n: number): SeatPos {
  if (k === 0) return "bottom";
  if (n === 2) return "top";
  if (n === 3) return k === 1 ? "left" : "right";
  return k === 1 ? "left" : k === 2 ? "top" : "right";
}

/** Where a card lands on the felt (% of its width / height), by the seat of whoever played it. */
const FELT_SPOT: Record<SeatPos, [number, number]> = {
  top: [50, 30],
  left: [22, 30],
  right: [78, 30],
  bottom: [50, 72],
};

/** Red dot in the corner of a player's frame: this player starts (leads) the trick. */
function LeaderDot() {
  return (
    <span
      role="img"
      aria-label="A început mâna"
      title="A început mâna"
      className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm"
    />
  );
}

export function Game({
  state,
  token,
  refresh,
  applyState,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  applyState: (state: RoomState) => void;
}) {
  const { room, players, me, game, result } = state;
  const isHost = room.hostPlayerId === me.id;
  const { busy, error, run } = useAction(room.code, token, refresh, applyState);
  const [confirmPlay] = useBoolPref(PREF_CONFIRM_PLAY, false);
  const [selected, setSelected] = useState<CardT | null>(null);
  // The card just tapped: shown on the felt at once, before the server answers.
  const [pending, setPending] = useState<CardT | null>(null);

  const byId = new Map([...players, ...state.spectators].map((p) => [p.id, p]));
  const nick = (id: string | null | undefined) => (id ? (byId.get(id)?.nickname ?? "cineva") : "cineva");

  if (!game) {
    return (
      <Card>
        <FinishedPanel state={state} isHost={isHost} busy={busy} run={run} nick={nick} />
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  }

  const myTurn = game.turn === me.id;
  const pick = selected && game.legal.includes(selected) ? selected : null;

  function tapCard(card: CardT) {
    if (!game!.legal.includes(card) || busy) return;
    if (confirmPlay) {
      setSelected(pick === card ? null : card);
      return;
    }
    play(card);
  }

  function play(card: CardT) {
    setSelected(null);
    setPending(card);
    void run("play", { card }).finally(() => setPending(null));
  }

  const leadRank = game.trick[0] ? rankOf(game.trick[0].card) : null;
  const status = statusText(game, me.id, nick, room.status === "finished");

  // Table seats: the viewer is always at the bottom (their cards sit right under the table); the others are in a
  // row on top in play order, left to right (next player first). A spectator watches from seat 0.
  const isSpectator = me.role === "spectator";
  const anchor = isSpectator ? game.order[0] : me.id;
  const seatCount = game.order.length;
  const anchorIdx = Math.max(game.order.indexOf(anchor), 0);
  const ring = Array.from({ length: seatCount }, (_, k) => game.order[(anchorIdx + k) % seatCount]);
  const others = ring.slice(1);

  const finished = room.status === "finished";
  const hand = pending ? game.hand.filter((c) => c !== pending) : game.hand;

  const renderSeat = (id: string) => (
    <Seat
      player={byId.get(id)}
      seatNo={game.order.indexOf(id) + 1}
      count={game.handCounts[id] ?? 0}
      isTurn={game.turn === id}
      isLeader={game.leader === id && !finished}
      partner={game.teams && byId.get(id)?.team === byId.get(anchor)?.team}
      canSkip={isHost && id !== me.id && game.turn === id && room.status === "playing"}
      busy={busy !== null}
      canKick={isHost && id !== me.id}
      onKick={() => {
        const target = byId.get(id);
        if (!target) return;
        const msg =
          room.status === "playing"
            ? `Scoți jucătorul ${target.nickname} din cameră? Are 10 secunde să refuze; dacă nu, runda se anulează pentru toți.`
            : `Scoți jucătorul ${target.nickname} din cameră?`;
        if (window.confirm(msg)) void run("kick", { playerId: id });
      }}
      onSkip={() => {
        if (window.confirm(`Joci în locul lui ${nick(id)}? (cartea cea mai mică, sau lasă mâna)`)) void run("skip");
      }}
    />
  );

  return (
    <>
      {finished && (
        <Card>
          <FinishedPanel state={state} isHost={isHost} busy={busy} run={run} nick={nick} />
          <ErrorText>{error}</ErrorText>
        </Card>
      )}
      <Scoreboard sides={game.sides} players={players} teams={game.teams} meId={me.id} />

      <Card className="flex flex-col gap-2">
        <div className="flex w-full items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-2">
            {game.stockCount > 0 ? <CardBack size="sm" className="!h-7 !w-5" /> : null}
            Pachet: {game.stockCount} {game.stockCount === 1 ? "carte" : "cărți"}
          </span>
          <span>Mâna {game.tricksPlayed + (game.trick.length > 0 ? 1 : 0)}</span>
        </div>

        <div
          className="mx-auto grid w-full gap-1.5"
          style={{ gridTemplateColumns: `repeat(${others.length}, minmax(0, 1fr))`, maxWidth: others.length === 1 ? "60%" : undefined }}
        >
          {others.map((id) => (
            <div key={id}>{renderSeat(id)}</div>
          ))}
        </div>
        <TrickTable
          game={game}
          anchorIdx={anchorIdx}
          seatCount={seatCount}
          nick={nick}
          pending={pending ? { playerId: me.id, card: pending } : null}
        />
        {isSpectator ? (
          <div className="mx-auto w-3/5">{renderSeat(ring[0])}</div>
        ) : (
          !finished && (
            <div
              className={`relative rounded-xl border p-1.5 ${
                me.team === 0 || me.team === 1 ? TEAM_STYLES[me.team] : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              } ${myTurn ? "ring-2 ring-indigo-500" : ""}`}
            >
              {game.leader === me.id && <LeaderDot />}
              {hand.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500">Nu mai ai cărți.</p>
              ) : (
                <div className="flex justify-center gap-1 sm:gap-2" data-testid="my-hand">
                  {hand.map((c) => {
                    const legal = game.legal.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => tapCard(c)}
                        disabled={!legal || busy !== null}
                        className={`rounded-lg transition-transform ${legal ? "enabled:hover:-translate-y-1" : myTurn ? "opacity-40" : ""} ${
                          pick === c ? "-translate-y-3 ring-4 ring-indigo-500" : ""
                        }`}
                        aria-label={`Joacă ${c}`}
                        data-card={c}
                        data-legal={legal}
                      >
                        <PlayingCard card={c} size="lg" />
                      </button>
                    );
                  })}
                </div>
              )}
              {confirmPlay && pick && (
                <Button className="mt-3 w-full" disabled={busy !== null} onClick={() => play(pick)}>
                  Joacă {rankOf(pick)}
                </Button>
              )}
            </div>
          )
        )}
        <ErrorText>{error}</ErrorText>

        {leadRank && (
          <p className="text-center text-xs text-zinc-500">
            Taie:{" "}
            {[leadRank, ...wildRanks(game.order.length).filter((r) => r !== leadRank)].map((r, i, all) => (
              <span key={r}>
                {i > 0 && (i === all.length - 1 ? " sau " : ", ")}
                <b>{rankLabel(r)}</b>
              </span>
            ))}
          </p>
        )}
        <p
          className={`text-center text-sm font-semibold ${myTurn ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-600 dark:text-zinc-300"}`}
          role="status"
          data-testid="game-status"
        >
          {status}
        </p>
        {game.canLetGo && (
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run("let-go")} data-testid="let-go">
            Las mâna lui {nick(game.holder)}
          </Button>
        )}
      </Card>

      {result === null && game.lastTrick && game.trick.length > 0 && (
        <p className="text-center text-xs text-zinc-500">
          Mâna trecută: {nick(game.lastTrick.winner)} (+{game.lastTrick.points}{" "}
          {game.lastTrick.points === 1 ? "punct" : "puncte"})
        </p>
      )}
    </>
  );
}

function statusText(game: GameView, meId: string, nick: (id: string | null) => string, finished: boolean): string {
  if (finished) return "Runda s-a terminat.";
  const lead = game.trick[0] ? cutHint(rankOf(game.trick[0].card), game.order.length) : null;
  if (game.turn === meId) {
    if (game.phase === "decide") return `Te-a tăiat ${nick(game.holder)}. Continui cu ${lead}, ori lași mâna.`;
    if (game.trick.length === 0) return "Începi tu mâna: pune orice carte.";
    return `E rândul tău. Taie cu ${lead}, ori pune altă carte.`;
  }
  if (game.phase === "decide") return `${nick(game.turn)} decide dacă mai continuă mâna…`;
  if (game.trick.length === 0) return `${nick(game.turn)} începe mâna…`;
  return `Așteaptă pe ${nick(game.turn)}…`;
}

/** The table: every card lies in front of the seat that played it; the card holding the trick is ringed. */
function TrickTable({
  game,
  anchorIdx,
  seatCount,
  nick,
  pending,
}: {
  game: GameView;
  anchorIdx: number;
  seatCount: number;
  nick: (id: string | null) => string;
  /** My card, tapped but not yet confirmed by the server. */
  pending: Play | null;
}) {
  const live = pending && !game.trick.some((p) => p.card === pending.card) ? [...game.trick, pending] : game.trick;
  const showingLast = live.length === 0 && game.lastTrick !== null;
  const plays = showingLast ? game.lastTrick!.plays : live;
  const hi = holderIndex(plays, game.order.length);
  const spot = (id: string): [number, number] => {
    const k = (game.order.indexOf(id) - anchorIdx + seatCount) % seatCount;
    return FELT_SPOT[seatPos(k, seatCount)];
  };
  return (
    <div className="relative h-44 w-full rounded-2xl bg-emerald-800 shadow-inner" data-testid="trick-table" data-last={showingLast}>
      {plays.length === 0 ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-emerald-100/80">Masa e goală</span>
      ) : (
        plays.map((p, i) => {
          const [x, y] = spot(p.playerId);
          return (
            <span
              key={`${p.card}-${i}`}
              data-card={p.card}
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${showingLast ? "opacity-60" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={nick(p.playerId)}
            >
              <PlayingCard card={p.card} size="sm" className={`!h-12 !w-9 ${i === hi ? "ring-2 ring-amber-400" : ""}`} />
            </span>
          );
        })
      )}
      {showingLast && (
        <span className="absolute inset-x-1 bottom-1 truncate text-center text-[10px] font-semibold text-emerald-50">
          {nick(game.lastTrick!.winner)} a luat mâna (+{game.lastTrick!.points})
        </span>
      )}
    </div>
  );
}

function Seat({
  player,
  seatNo,
  count,
  isTurn,
  isLeader,
  partner,
  canSkip,
  busy,
  canKick,
  onKick,
  onSkip,
}: {
  player: PublicPlayer | undefined;
  seatNo: number;
  count: number;
  isTurn: boolean;
  isLeader: boolean;
  partner: boolean;
  canSkip: boolean;
  busy: boolean;
  canKick: boolean;
  onKick: () => void;
  onSkip: () => void;
}) {
  const team = player?.team;
  return (
    <div
      data-testid="seat"
      data-player-id={player?.id}
      data-turn={isTurn}
      className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 text-center ${
        team === 0 || team === 1 ? TEAM_STYLES[team] : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      } ${isTurn ? "ring-2 ring-indigo-500" : ""}`}
    >
      {isLeader && <LeaderDot />}
      <span className="max-w-full truncate px-3 text-sm font-semibold">
        {isTurn && "▶ "}
        {player?.nickname ?? "?"}
      </span>
      <span className="flex min-h-4 flex-wrap justify-center gap-1">
        <span
          className="rounded-full bg-zinc-200 px-1.5 text-[9px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          title="Locul în ordinea de joc"
        >
          {seatNo}
        </span>
        {isTurn && (
          <span className="rounded-full bg-indigo-600 px-1.5 text-[9px] font-bold uppercase text-white">
            urmează
          </span>
        )}
        {partner && (
          <span className="rounded-full border border-zinc-400 px-1.5 text-[9px] font-bold uppercase text-zinc-500">partener</span>
        )}
      </span>
      <OfflineBadge connected={player?.connected} />
      <KickBadge remainingMs={player?.kickRemainingMs ?? null} />
      <span className="flex h-8 items-center">
        {Array.from({ length: count }, (_, i) => (
          <CardBack key={i} size="sm" className={`!h-8 !w-6 ${i > 0 ? "-ml-3" : ""}`} />
        ))}
        {count === 0 && <span className="text-xs text-zinc-400">fără cărți</span>}
      </span>
      {canKick && player && player.kickRemainingMs === null && (
        <button
          type="button"
          disabled={busy}
          onClick={onKick}
          className="min-h-8 max-w-full rounded-md border border-rose-300 px-2 text-[11px] font-semibold leading-tight text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
          aria-label={`Scoate pe ${player.nickname}`}
        >
          Scoate
        </button>
      )}
      {canSkip && (
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="min-h-8 max-w-full rounded-md border border-zinc-300 px-2 text-[11px] font-semibold leading-tight text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          Joacă pentru el
        </button>
      )}
    </div>
  );
}

function sideName(side: SideView, players: PublicPlayer[], teams: boolean): string {
  const names = side.members.map((id) => players.find((p) => p.id === id)?.nickname ?? "?");
  if (!teams) return names[0];
  const team = players.find((p) => p.id === side.members[0])?.team ?? side.index;
  return `${TEAM_NAMES[team]} (${names.join(" + ")})`;
}

function Scoreboard({ sides, players, teams, meId }: { sides: SideView[]; players: PublicPlayer[]; teams: boolean; meId: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 text-sm" data-testid="scoreboard">
      {sides.map((s) => (
        <span
          key={s.index}
          className={`rounded-full border px-3 py-1 ${
            s.members.includes(meId) ? "border-indigo-400 font-bold" : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {sideName(s, players, teams)}: <b>{s.points}</b> {s.points === 1 ? "punct" : "puncte"}
        </span>
      ))}
    </div>
  );
}

/** Host-only up/down arrows to set the play order (first = starts the next round). */
export function OrderControls({
  state,
  busy,
  run,
  nextRound,
}: {
  state: RoomState;
  busy: string | null;
  run: (action: string, body?: unknown) => Promise<void>;
  /** Round number the order applies to (round 1 starts with the first player, then it moves one seat each round). */
  nextRound: number;
}) {
  const { players, room } = state;
  const startIdx = players.length > 0 ? (((nextRound - 1) % players.length) + players.length) % players.length : 0;
  return (
    <ol className="mx-auto flex w-full max-w-xs flex-col gap-1 text-left text-sm">
      {players.map((p, i) => {
        const up = movedOrder(players, p.id, -1, room.teams);
        const down = movedOrder(players, p.id, 1, room.teams);
        const btn =
          "min-h-8 min-w-8 rounded-md border border-zinc-300 text-sm font-bold disabled:opacity-30 dark:border-zinc-700";
        return (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-900">
            <span className="min-w-0 truncate">
              <span className="mr-2 text-xs font-bold text-zinc-500">{i + 1}</span>
              {p.nickname}
              {i === startIdx && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600">începe</span>}
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                className={btn}
                disabled={busy !== null || !up}
                onClick={() => up && void run("reorder", { order: up })}
                aria-label={`Mută ${p.nickname} mai sus`}
              >
                ↑
              </button>
              <button
                type="button"
                className={btn}
                disabled={busy !== null || !down}
                onClick={() => down && void run("reorder", { order: down })}
                aria-label={`Mută ${p.nickname} mai jos`}
              >
                ↓
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FinishedPanel({
  state,
  isHost,
  busy,
  run,
  nick,
}: {
  state: RoomState;
  isHost: boolean;
  busy: string | null;
  run: (action: string, body?: unknown) => Promise<void>;
  nick: (id: string | null) => string;
}) {
  const { result, players, room, me } = state;
  if (!result) return null;
  const teams = room.teams && result.sides.some((s) => s.members.length > 1);
  const draw = result.winners.length > 1;
  const winner = result.winners.length === 1 ? result.sides[result.winners[0]] : null;
  const iWon = winner?.members.includes(me.id) ?? false;

  return (
    <div className="flex flex-col gap-3 text-center" data-testid="finished-panel">
      {result.aborted ? (
        <p className="text-lg font-bold">Runda s-a anulat: {result.aborted.nickname} a plecat.</p>
      ) : draw ? (
        <p className="text-2xl font-black">🤝 Egalitate!</p>
      ) : (
        <p className="text-2xl font-black">
          🏆 {winner ? sideName(winner, players, teams) : nick(null)} câștigă!
          {iWon && <span className="block text-sm font-semibold text-emerald-600">Felicitări!</span>}
        </p>
      )}
      <ul className="mx-auto flex w-full max-w-xs flex-col gap-1 text-sm">
        {result.sides.map((s) => (
          <li key={s.index} className="flex justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-900">
            <span className="truncate">{sideName(s, players, teams)}</span>
            <span className="shrink-0 font-bold">
              {s.points} p · {s.cards} cărți
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        Runde câștigate:{" "}
        {players.map((p) => `${p.nickname} ${p.wins}`).join(" · ")}
      </p>
      {isHost ? (
        <>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold">Ordinea la runda următoare</h3>
            <OrderControls state={state} busy={busy} run={run} nextRound={room.round + 1} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy !== null} onClick={() => void run("new-round")} data-testid="new-round">
              {busy === "new-round" ? "Se împarte…" : "Rundă nouă"}
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void run("lobby")} data-testid="back-to-lobby">
              Înapoi în lobby
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Host-ul pornește runda următoare.</p>
      )}
    </div>
  );
}
