"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";

/** POSTs a room action, then refreshes state. Tracks which action is running and the last error. */
export function useAction(code: string, token: string, refresh: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = useCallback(
    async (action: string, body: unknown = {}) => {
      setBusy(action);
      setError("");
      try {
        await api(`/api/rooms/${code}/${action}`, { token, body });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare.");
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [code, token, refresh],
  );

  return { busy, error, run, setError };
}

export const TEAM_NAMES = ["Echipa 1", "Echipa 2"];
export const TEAM_STYLES = [
  "border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950",
  "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
];
