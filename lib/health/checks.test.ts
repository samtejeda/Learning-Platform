import { describe, expect, it, vi } from "vitest";
import { createTtlCache, runCheck, summarize } from "./checks";

describe("summarize", () => {
  it("is 200 with a bare ok body when every dependency is up", () => {
    expect(summarize({ database: "ok", auth: "ok" })).toEqual({
      httpStatus: 200,
      body: { status: "ok" },
    });
  });

  it("is 503 and names only the failing check when a dependency is down", () => {
    expect(summarize({ database: "fail", auth: "ok" })).toEqual({
      httpStatus: 503,
      body: { status: "degraded", checks: { database: "fail", auth: "ok" } },
    });
    expect(summarize({ database: "ok", auth: "fail" }).httpStatus).toBe(503);
  });
});

describe("runCheck", () => {
  it("returns ok when the probe resolves", async () => {
    expect(await runCheck(async () => 1, 50)).toBe("ok");
  });

  it("returns fail, and reports the reason, when the probe rejects", async () => {
    const onFailure = vi.fn();
    expect(await runCheck(() => Promise.reject(new Error("boom")), 50, onFailure)).toBe("fail");
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("returns fail when the probe hangs past the deadline", async () => {
    const started = Date.now();
    const result = await runCheck(() => new Promise(() => {}), 30);
    expect(result).toBe("fail");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("createTtlCache", () => {
  it("serves the cached value until the ttl expires, then reloads", async () => {
    let t = 1_000;
    const cache = createTtlCache<number>(10_000, () => t);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get(load)).toBe(1);
    t += 9_999;
    expect(await cache.get(load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);

    t += 2;
    expect(await cache.get(load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent callers onto a single load", async () => {
    const cache = createTtlCache<string>(10_000);
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const calls = Promise.all([cache.get(load), cache.get(load), cache.get(load)]);
    release("done");
    expect(await calls).toEqual(["done", "done", "done"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load, so the next caller retries", async () => {
    const cache = createTtlCache<number>(10_000);
    const load = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(7);

    await expect(cache.get(load)).rejects.toThrow("x");
    expect(await cache.get(load)).toBe(7);
  });
});
