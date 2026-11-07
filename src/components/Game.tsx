"use client";

import { useState } from "react";
import { PREF_CONFIRM_PLAY, useBoolPref } from "@/lib/client/prefs";
import { type Card as CardT, cuts, type Play, rankLabel, rankOf } from "@/lib/septica";
import type { GameView, PublicPlayer, RoomState, SideView } from "@/lib/types";
import { CardBack, PlayingCard } from "./PlayingCard";
import { Button, Card, ErrorText } from "./ui";
import { TEAM_NAMES, TEAM_STYLES, useAction } from "./useAction";

/** Index (in the trick) of the card currently holding it. */
function holderIndex(trick: Play[]): number {
  if (trick.length === 0) return -1;
  const lead = rankOf(trick[0].card);
  let idx = 0;
  trick.forEach((p, i) => {
    if (i > 0 && cuts(p.card, lead)) idx = i;
  });
  return idx;
}

export function Game({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, players, me, game, result } = state;
  const isHost = room.hostPlayerId === me.id;
  const { busy, error, run } = useAction(room.code, token, refresh);
  const [confirmPlay] = useBoolPref(PREF_CONFIRM_PLAY, false);
  const [selected, setSelected] = useState<CardT | null>(null);

  const byId = new Map(players.map((p) => [p.id, p]));
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
    void run("play", { card });
  }

  function play(card: CardT) {
    setSelected(null);
    void run("play", { card });
  }

  const leadRank = game.trick[0] ? rankOf(game.trick[0].card) : null;
  const status = statusText(game, me.id, nick, room.status === "finished");

  // Other seats, in play order starting after me.
  const mySeat = game.order.indexOf(me.id);
  const others = [...game.order.slice(mySeat + 1), ...game.order.slice(0, Math.max(mySeat, 0))].filter((id) => id !== me.id);

  const finished = room.status === "finished";

  return (
    <>
      {finished && (
        <Card>
          <FinishedPanel state={state} isHost={isHost} busy={busy} run={run} nick={nick} />
          <ErrorText>{error}</ErrorText>
        </Card>
      )}
      <Scoreboard sides={game.sides} players={players} teams={game.teams} meId={me.id} />

      <div className={`grid gap-2 ${others.length === 1 ? "grid-cols-1" : others.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {others.map((id) => (
          <Seat
            key={id}
            player={byId.get(id)}
            count={game.handCounts[id] ?? 0}
            isTurn={game.turn === id}
            isLeader={game.leader === id && game.trick.length > 0}
            partner={game.teams && byId.get(id)?.team === me.team}
            canSkip={isHost && game.turn === id && room.status === "playing"}
            busy={busy !== null}
            onSkip={() => {
              if (window.confirm(`Joci în locul lui ${nick(id)}? (cartea cea mai mică, sau lasă mâna)`)) void run("skip");
            }}
          />
        ))}
      </div>

      <Card className="flex flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-2">
            {game.stockCount > 0 ? <CardBack size="sm" className="!h-7 !w-5" /> : null}
            Pachet: {game.stockCount} {game.stockCount === 1 ? "carte" : "cărți"}
          </span>
          <span>Mâna {game.tricksPlayed + (game.trick.length > 0 ? 1 : 0)}</span>
        </div>

        <TrickArea game={game} nick={nick} />

        {leadRank && (
          <p className="text-xs text-zinc-500">
            Taie: <b>{rankLabel(leadRank)}</b> sau <b>7</b>
          </p>
        )}
        <p
          className={`text-center text-sm font-semibold ${myTurn ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-600 dark:text-zinc-300"}`}
          role="status"
        >
          {status}
        </p>
        {game.canLetGo && (
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run("let-go")}>
            Las mâna lui {nick(game.holder)}
          </Button>
        )}
      </Card>

      {!finished && (
      <Card className={myTurn ? "ring-2 ring-indigo-500" : ""}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Cărțile tale</h2>
          {game.teams && me.team !== null && <span className="text-xs text-zinc-500">{TEAM_NAMES[me.team]}</span>}
        </div>
        {game.hand.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Nu mai ai cărți.</p>
        ) : (
          <div className="flex justify-center gap-1.5 sm:gap-2">
            {game.hand.map((c) => {
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
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>
      )}

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
  const lead = game.trick[0] ? rankLabel(rankOf(game.trick[0].card)) : null;
  if (game.turn === meId) {
    if (game.phase === "decide") return `Te-a tăiat ${nick(game.holder)}. Continui cu ${lead} sau 7, ori lași mâna.`;
    if (game.trick.length === 0) return "Începi tu mâna: pune orice carte.";
    return `E rândul tău. Taie cu ${lead} sau 7, ori pune altă carte.`;
  }
  if (game.phase === "decide") return `${nick(game.turn)} decide dacă mai continuă mâna…`;
  return `Așteaptă pe ${nick(game.turn)}…`;
}

function TrickArea({ game, nick }: { game: GameView; nick: (id: string | null) => string }) {
  const showingLast = game.trick.length === 0 && game.lastTrick !== null;
  const plays = showingLast ? game.lastTrick!.plays : game.trick;
  const hi = holderIndex(plays);

  if (plays.length === 0) {
    return <div className="flex h-28 items-center text-sm text-zinc-400">Masa e goală.</div>;
  }
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className={`flex min-h-28 flex-wrap justify-center gap-1.5 ${showingLast ? "opacity-60" : ""}`}>
        {plays.map((p, i) => (
          <span key={`${p.card}-${i}`} className="flex flex-col items-center gap-0.5">
            <PlayingCard card={p.card} size="md" className={i === hi ? "ring-4 ring-amber-400" : ""} />
            <span className="max-w-14 truncate text-[10px] text-zinc-500">{nick(p.playerId)}</span>
          </span>
        ))}
      </div>
      {showingLast && (
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          {nick(game.lastTrick!.winner)} a luat mâna (+{game.lastTrick!.points}{" "}
          {game.lastTrick!.points === 1 ? "punct" : "puncte"})
        </p>
      )}
    </div>
  );
}

function Seat({
  player,
  count,
  isTurn,
  isLeader,
  partner,
  canSkip,
  busy,
  onSkip,
}: {
  player: PublicPlayer | undefined;
  count: number;
  isTurn: boolean;
  isLeader: boolean;
  partner: boolean;
  canSkip: boolean;
  busy: boolean;
  onSkip: () => void;
}) {
  const team = player?.team;
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center ${
        team === 0 || team === 1 ? TEAM_STYLES[team] : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      } ${isTurn ? "ring-2 ring-indigo-500" : ""}`}
    >
      <span className="max-w-full truncate text-sm font-semibold">
        {isTurn && "▶ "}
        {player?.nickname ?? "?"}
      </span>
      <span className="text-[10px] uppercase text-zinc-500">
        {partner ? "partener" : ""}
        {partner && isLeader ? " · " : ""}
        {isLeader ? "a început" : ""}
        {!partner && !isLeader ? " " : ""}
      </span>
      <span className="flex h-8 items-center">
        {Array.from({ length: count }, (_, i) => (
          <CardBack key={i} size="sm" className={`!h-8 !w-6 ${i > 0 ? "-ml-3" : ""}`} />
        ))}
        {count === 0 && <span className="text-xs text-zinc-400">fără cărți</span>}
      </span>
      {canSkip && (
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="min-h-8 rounded-md border border-zinc-300 px-2 text-[11px] font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
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
    <div className="flex flex-wrap justify-center gap-2 text-sm">
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
    <div className="flex flex-col gap-3 text-center">
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
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy !== null} onClick={() => void run("new-round")}>
            {busy === "new-round" ? "Se împarte…" : "Rundă nouă"}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run("lobby")}>
            Înapoi în lobby
          </Button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Host-ul pornește runda următoare.</p>
      )}
    </div>
  );
}
