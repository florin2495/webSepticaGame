"use client";

import type { RoomState } from "@/lib/types";
import { OfflineBadge } from "./KickBadge";
import { Button, Card, ErrorText } from "./ui";
import { useAction } from "./useAction";

/** Spectator list, plus "Intră la runda următoare" for a spectator (toggle, POST /queue). */
export function Spectators({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me, spectators } = state;
  const { busy, error, run } = useAction(room.code, token, refresh);
  const isHost = room.hostPlayerId === me.id;
  const isSpectator = me.role === "spectator";
  if (!isSpectator && spectators.length === 0) return null;

  return (
    <Card className="flex flex-col gap-2" data-testid="spectator-list">
      <h2 className="font-bold">Spectatori ({spectators.length}/16)</h2>
      {isSpectator && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300" data-testid="spectator-status">
            Privești runda. Nu vezi cărțile nimănui și nu poți juca.
          </p>
          <Button
            variant={me.queued ? "secondary" : "primary"}
            disabled={busy !== null}
            onClick={() => void run("queue")}
            data-testid="queue-toggle"
            data-queued={me.queued}
          >
            {room.status === "lobby" ? "Intră în joc" : me.queued ? "Nu mai intru la runda următoare" : "Intră la runda următoare"}
          </Button>
          {me.queued && <p className="text-xs text-zinc-500">Ești în coadă: vei juca la runda următoare dacă sunt locuri libere.</p>}
        </>
      )}
      {spectators.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {spectators.map((s) => (
            <li key={s.id} data-player-id={s.id} data-queued={s.queued} className="flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-0.5 dark:border-zinc-700">
              <span>
                {s.nickname}
                {s.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {s.queued && <span className="text-[10px] font-bold uppercase text-indigo-600">în coadă</span>}
              <OfflineBadge connected={s.connected} />
              {isHost && (
                <button
                  type="button"
                  disabled={busy !== null}
                  className="ml-1 text-xs font-bold text-rose-600 disabled:opacity-40"
                  aria-label={`Scoate pe ${s.nickname}`}
                  onClick={() => {
                    if (window.confirm(`Scoți spectatorul ${s.nickname}?`)) void run("kick", { playerId: s.id });
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
