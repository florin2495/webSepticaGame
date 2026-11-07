"use client";

import { MAX_PLAYERS, MIN_PLAYERS, teamProblem } from "@/lib/septica";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { Rules } from "./Home";
import { KickBadge, OfflineBadge } from "./KickBadge";
import { Button, Card, ErrorText, Toggle } from "./ui";
import { TEAM_NAMES, TEAM_STYLES, useAction } from "./useAction";

export function Lobby({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, players, me } = state;
  const isHost = room.hostPlayerId === me.id;
  const { busy, error, run } = useAction(room.code, token, refresh);

  const allReady = players.every((p) => p.ready);
  const teamIssue = teamProblem(players, room.teams);
  const startIssue =
    players.length < MIN_PLAYERS
      ? `Mai trebuie cel puțin un jucător. Trimite-le codul ${room.code}.`
      : teamIssue ?? (allReady ? null : "Așteaptă să fie toți gata.");

  async function kick(p: PublicPlayer) {
    if (!window.confirm(`Scoți jucătorul ${p.nickname} din cameră?`)) return;
    await run("kick", { playerId: p.id });
  }

  const row = (p: PublicPlayer) => (
    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">
          {p.nickname}
          {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
        </span>
        {p.isHost && <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>}
        <OfflineBadge connected={p.connected} />
        <KickBadge remainingMs={p.kickRemainingMs} />
        {p.wins > 0 && <span className="text-xs text-amber-600">🏆{p.wins}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {p.ready ? (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ gata</span>
        ) : (
          <span className="text-sm text-zinc-500">se pregătește…</span>
        )}
        {isHost && p.id !== me.id && (
          <button
            type="button"
            onClick={() => void kick(p)}
            disabled={busy !== null}
            className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
            aria-label={`Scoate pe ${p.nickname}`}
          >
            Scoate
          </button>
        )}
      </span>
    </li>
  );

  return (
    <>
      <Card>
        <h2 className="mb-1 font-bold">
          Jucători ({players.length}/{MAX_PLAYERS})
        </h2>
        {room.teams ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((t) => (
              <div key={t} className={`rounded-lg border px-3 py-1 ${TEAM_STYLES[t]}`}>
                <h3 className="pt-1 text-sm font-bold">{TEAM_NAMES[t]}</h3>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {players.filter((p) => p.team === t).map(row)}
                </ul>
                {me.team !== t && (
                  <Button variant="secondary" className="my-2 w-full text-sm" disabled={busy !== null} onClick={() => void run("team", { team: t })}>
                    Trec în {TEAM_NAMES[t]}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">{players.map(row)}</ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <Toggle
          label="Pe echipe (2 contra 2)"
          hint={isHost ? "Doar în 4 jucători. Schimbarea resetează „gata” la toți." : "Doar host-ul poate schimba."}
          checked={room.teams}
          disabled={!isHost || busy !== null}
          onChange={(v) => void run("settings", { teams: v })}
        />
        <Button
          variant={me.ready ? "secondary" : "primary"}
          disabled={busy !== null}
          onClick={() => void run("ready", { ready: !me.ready })}
        >
          {me.ready ? "Nu mai sunt gata" : "Sunt gata"}
        </Button>
        {isHost ? (
          <>
            <Button disabled={busy !== null || startIssue !== null} onClick={() => void run("start")}>
              {busy === "start" ? "Se împart cărțile…" : "Împarte cărțile"}
            </Button>
            {startIssue && <p className="text-center text-sm text-zinc-500">{startIssue}</p>}
          </>
        ) : (
          <p className="text-center text-sm text-zinc-500">Host-ul împarte cărțile când sunteți toți gata.</p>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>

      <Rules />
    </>
  );
}
