"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/** When (Date.now()) the current state arrived: pending-kick countdowns run from the received ms, not a clock. */
export const KickClockContext = createContext<number>(0);

/** Seconds left (ceil) for a pending kick, ticking live; null when nothing is pending. */
export function useKickSeconds(remainingMs: number | null): number | null {
  const receivedAt = useContext(KickClockContext);
  const [now, setNow] = useState(() => Date.now());
  const pending = remainingMs !== null;
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pending]);
  if (remainingMs === null) return null;
  return Math.ceil(Math.max(0, remainingMs - Math.max(0, now - receivedAt)) / 1000);
}

/** Shown next to a player not seen for 301 s (phone in the background, closed tab, no network). */
export function OfflineBadge({ connected }: { connected: boolean | undefined }) {
  if (connected !== false) return null;
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      deconectat
    </span>
  );
}

/** "iese în n s" next to a player whose kick is pending. */
export function KickBadge({ remainingMs }: { remainingMs: number | null }) {
  const seconds = useKickSeconds(remainingMs);
  if (seconds === null) return null;
  return (
    <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      iese în {seconds} s
    </span>
  );
}

/** Blocking modal for the player whose kick is pending. The only way out is "Ignoră". */
export function KickModal({
  state,
  token,
  refresh,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}) {
  const seconds = useKickSeconds(state.me.kickRemainingMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (seconds === null) return null;

  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${state.room.code}/kick/ignore`, { token, body: {} });
    } catch (err) {
      // 401 = already removed: the refresh below shows the usual "removed" screen.
      if (!(err instanceof ApiRequestError && err.status === 401)) setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 id="kick-title" className="text-xl font-black">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="text-sm text-zinc-600 dark:text-zinc-300">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {seconds} s ca să rămâi în joc.
        </p>
        <p className="text-4xl font-black tabular-nums text-rose-600 dark:text-rose-400" aria-hidden="true">
          {seconds}
        </p>
        <Button disabled={busy} onClick={() => void ignore()}>
          Ignoră
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
