import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Regression guard: the limiter's opportunistic sweep is fire-and-forget on
// the same pool as everything else. With the dev pool's single connection a
// hang here would freeze every request until the sweep finishes.
describe("rate-limit sweep", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not block subsequent queries when the sweep fires", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // force the sweep every call
    const started = Date.now();
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit({
        scope: "invite",
        kind: "id",
        subject: `sweep-test-${started}`,
        window: RATE_LIMITS.invite.perIdentifier,
      });
      expect(r.ok).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 25_000);
});
