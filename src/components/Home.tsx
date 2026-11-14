"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, clearSession, deviceId, listSessions, parseSession, readSessionRaw, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { NICKNAME_MAX } from "@/lib/septica";
import type { RoomListItem, RoomState } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
import { PlayingCard } from "./PlayingCard";
import { RoomList } from "./RoomList";
import { Button, Card, ErrorText, Field, Toggle } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nickname defaults to the last one used on this device.
  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [teams, setTeams] = useState(false);
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    nicknameRef.current?.focus();
  }

  // Password field is hidden only when the picked room is known to have none.
  const showPassword = tab === "create" || !(picked && picked.code === code && !picked.hasPassword);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    // Already a member on this device: go back to the seat instead of joining again.
    if (tab === "join" && parseSession(readSessionRaw(joinCode))) {
      router.push(`/room/${joinCode}`);
      return;
    }
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, teams, deviceId: deviceId() } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(joinCode)}/join`, {
              body: { nickname, password, deviceId: deviceId() },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        {/* Plain <a> on purpose: "/" is the hub zone, outside basePath; needs a full navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <div className="mb-3 flex justify-center gap-1" aria-hidden>
          {["7S", "10H", "AD", "7C"].map((c, i) => (
            <span key={c} style={{ transform: `rotate(${(i - 1.5) * 8}deg)` }}>
              <PlayingCard card={c} size="sm" />
            </span>
          ))}
        </div>
        <h1 className="text-4xl font-black tracking-tight">Șeptică</h1>
        <p className="mt-1 text-sm text-zinc-500">Șeptica clasică, cu 1–3 prieteni, pe telefon. La 4, și pe echipe.</p>
      </header>

      <RejoinCards onRejoin={(c) => router.push(`/room/${c}`)} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            data-testid={`tab-${t}`}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card>
          <RoomList
            selected={picked?.code === code ? code : null}
            onSelect={pickRoom}
            onRejoin={(c) => router.push(`/room/${c}`)}
          />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : picked?.code === code ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && picked?.code === code && picked.hasPassword}
            />
          )}
          {tab === "create" && (
            <Toggle
              label="Pe echipe (2 contra 2)"
              hint="Doar în 4 jucători. Partenerii stau față în față și adună punctele împreună. Se poate schimba din lobby."
              checked={teams}
              onChange={setTeams}
            />
          )}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} data-testid="home-submit">
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : "Intră"}
          </Button>
        </form>
      </Card>

      <Rules />
    </main>
  );
}

/**
 * Rooms this device still has a valid seat in (lobby, a running deal or a finished one; the public list only
 * shows lobbies). Stored sessions are checked once against /state; 401/404 ones are dropped.
 */
function RejoinCards({ onRejoin }: { onRejoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<{ code: string; name: string; playing: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        listSessions().map(async ({ code, session }) => {
          try {
            const s = await api<RoomState>(`/api/rooms/${code}/state`, { token: session.token });
            return { code, name: s.room.name, playing: s.room.status === "playing" };
          } catch (err) {
            if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) clearSession(code);
            return null;
          }
        }),
      );
      if (!cancelled) setRooms(checks.filter((r) => r !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((r) => (
        <button
          key={r.code}
          type="button"
          onClick={() => onRejoin(r.code)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left dark:border-indigo-800 dark:bg-indigo-950"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              Revino în camera <span className="font-mono tracking-widest">{r.code}</span>
            </span>
            <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
              {r.name}
              {r.playing ? " · joc în desfășurare" : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Reintră →</span>
        </button>
      ))}
    </div>
  );
}

export function Rules() {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Pachet de 32 de cărți (7–A). În 3 jucători se scot doi de 8, rămân 30.</li>
        <li>Fiecare are mereu 4 cărți în mână. Nu ești obligat să răspunzi la culoare sau la valoare.</li>
        <li>
          Cine începe mâna pune o carte. Pe rând, fiecare pune câte una. <b>Taie</b> cartea de aceeași valoare cu prima, sau
          orice <b>7</b>.
        </li>
        <li>
          După ce a pus toată lumea, dacă ai început și ai fost tăiat, poți <b>continua</b> cu o carte de aceeași valoare
          sau un 7 (și toată lumea mai pune o carte), sau <b>lași mâna</b>.
        </li>
        <li>Mâna o ia ultimul care a tăiat (sau cel care a început, dacă nu a tăiat nimeni). El trage primul din pachet și începe mâna următoare.</li>
        <li>Fiecare 10 și fiecare As valorează 1 punct (8 în total). Câștigă cine are cele mai multe puncte; 4–4 e egal.</li>
        <li>În 4 jucători se poate juca pe echipe: jucătorii 1 și 3 contra 2 și 4. Punctele partenerilor se adună.</li>
      </ol>
    </details>
  );
}
