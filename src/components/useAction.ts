"use client";

import { useCallback, useState } from "react";
import { actionsInFlight, api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";

/**
 * POSTs a room action, then refreshes state. Tracks which action is running and the last error.
 * When the endpoint answers with the new RoomState and `applyState` is given, that state is applied directly
 * and no extra GET is made.
 */
export function useAction(
  code: string,
  token: string,
  refresh: () => Promise<void>,
  applyState?: (state: RoomState) => void,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = useCallback(
    async (action: string, body: unknown = {}) => {
      setBusy(action);
      setError("");
      let applied = false;
      actionsInFlight.count++;
      try {
        const res = await api<Partial<RoomState>>(`/api/rooms/${code}/${action}`, { token, body });
        if (applyState && res.room && res.me) {
          applyState(res as RoomState);
          applied = true;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare.");
      } finally {
        actionsInFlight.count--;
        if (!applied) await refresh();
        setBusy(null);
      }
    },
    [code, token, refresh, applyState],
  );

  return { busy, error, run, setError };
}

export const TEAM_NAMES = ["Echipa 1", "Echipa 2"];
export const TEAM_STYLES = [
  "border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950",
  "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
];
