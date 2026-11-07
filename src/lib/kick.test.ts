import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_ENFORCE_MS, KICK_GRACE_MS, kickRemainingMs } from "./kick";

const T0 = Date.parse("2026-01-01T12:00:00Z");

describe("kickRemainingMs", () => {
  it("is null when nothing is pending", () => {
    expect(kickRemainingMs(null, T0)).toBeNull();
    expect(kickRemainingMs(undefined, T0)).toBeNull();
  });
  it("counts down from the grace period", () => {
    const at = new Date(T0).toISOString();
    expect(kickRemainingMs(at, T0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(at, T0 + 4_000)).toBe(6_000);
  });
  it("clamps to [0, KICK_GRACE_MS]", () => {
    const at = new Date(T0).toISOString();
    expect(kickRemainingMs(at, T0 + 60_000)).toBe(0);
    expect(kickRemainingMs(at, T0 - 5_000)).toBe(KICK_GRACE_MS); // clock skew
  });
});

describe("isKickExpired", () => {
  const at = new Date(T0).toISOString();
  it("is false without a pending kick", () => expect(isKickExpired(null, T0)).toBe(false));
  it("allows the network grace after the 10 s", () => {
    expect(isKickExpired(at, T0 + KICK_GRACE_MS + 1)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS + 1)).toBe(true);
  });
});
