/** Pending kick during a running game: the host's kick waits KICK_GRACE_MS for the player to press "Ignoră". */
export const KICK_GRACE_MS = 10_000;
/** Extra time for the "Ignoră" request to arrive; the removal is only enforced after grace + this. */
export const KICK_NETWORK_GRACE_MS = 2_000;
export const KICK_ENFORCE_MS = KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;

const toMs = (t: string | number | Date): number => (typeof t === "number" ? t : new Date(t).getTime());

/** Milliseconds left to press "Ignoră", clamped to [0, KICK_GRACE_MS]; null when no kick is pending. */
export function kickRemainingMs(requestedAt: string | number | Date | null | undefined, now: number): number | null {
  if (requestedAt === null || requestedAt === undefined) return null;
  const left = toMs(requestedAt) + KICK_GRACE_MS - now;
  if (Number.isNaN(left)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, left));
}

/** True once the pending kick is past grace + network grace: the player must be removed, "Ignoră" is too late. */
export function isKickExpired(requestedAt: string | number | Date | null | undefined, now: number): boolean {
  if (requestedAt === null || requestedAt === undefined) return false;
  return now - toMs(requestedAt) > KICK_ENFORCE_MS;
}
