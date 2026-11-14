"use client";

import { useCallback, useEffect, useState } from "react";
import { api, parseSession, readSessionRaw } from "@/lib/client/api";
import { MAX_PLAYERS } from "@/lib/septica";
import type { RoomListItem, RoomStatus } from "@/lib/types";

const POLL_MS = 10_000;

const STATUS_BADGE: Record<RoomStatus, { label: string; className: string }> = {
  lobby: { label: "Lobby", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  playing: { label: "În joc", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  finished: { label: "Pauză", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

/** Public list of all live rooms (lobby, in-game, finished). Tap one to select it. */
export function RoomList({
  selected,
  onSelect,
  onRejoin,
}: {
  selected: string | null;
  onSelect: (room: RoomListItem) => void;
  onRejoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kick = () => void load();
    const first = window.setTimeout(kick, 0);
    const interval = window.setInterval(kick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const refreshButton = (
    <button
      type="button"
      onClick={() => void load()}
      aria-label="Reîncarcă camerele"
      title="Reîncarcă camerele"
      className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={loading ? "animate-spin" : ""}
      >
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v5h-5" />
      </svg>
    </button>
  );

  let content;
  if (rooms === null) {
    content = <p className="py-4 text-center text-sm text-zinc-500">{error || "Caut camere…"}</p>;
  } else if (rooms.length === 0) {
    content = (
      <p className="py-4 text-center text-sm text-zinc-500">
        Nicio cameră deschisă acum. Creează una sau introdu un cod mai jos.
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-2" data-testid="room-list">
        {rooms.map((r) => {
          const mine = parseSession(readSessionRaw(r.code)) !== null;
          const active = selected === r.code;
          const canSit = r.status === "lobby" && r.players < MAX_PLAYERS;
          const badge = STATUS_BADGE[r.status];
          return (
            <li key={r.code} data-code={r.code} data-status={r.status}>
              <button
                type="button"
                onClick={() => (mine ? onRejoin(r.code) : onSelect(r))}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {r.hasPassword && <span aria-label="cu parolă">🔒 </span>}
                    {r.name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    <span className={`mr-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.className}`}>
                      {badge.label}
                    </span>
                    {r.teams ? "pe echipe (2 vs 2)" : "fiecare pentru el"} · {r.players}/{MAX_PLAYERS}{" "}
                    {r.players === 1 ? "jucător" : "jucători"}
                    {r.spectators > 0 && ` · ${r.spectators} ${r.spectators === 1 ? "spectator" : "spectatori"}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold tracking-widest">{r.code}</span>
                  <span className="block text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                    {mine ? "Reintră" : canSit ? "Join" : "Privește"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Camere</h2>
        {refreshButton}
      </div>
      {content}
    </div>
  );
}
