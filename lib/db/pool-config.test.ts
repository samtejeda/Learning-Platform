import { describe, expect, it } from "vitest";
import { DEFAULT_PROD_POOL_MAX, isTransactionPoolerUrl, resolvePoolMax } from "./pool-config";

describe("resolvePoolMax", () => {
  it("defaults to a small pool in production and a single connection in dev", () => {
    expect(resolvePoolMax(undefined, true)).toBe(DEFAULT_PROD_POOL_MAX);
    expect(resolvePoolMax(undefined, false)).toBe(1);
  });

  it("honours a valid override in either environment", () => {
    expect(resolvePoolMax("3", true)).toBe(3);
    expect(resolvePoolMax("20", true)).toBe(20);
    expect(resolvePoolMax("2", false)).toBe(2);
  });

  it("ignores garbage and out-of-range values instead of trusting them", () => {
    for (const bad of ["", "abc", "0", "-4", "21", "1000", "3.5x", " "]) {
      expect(resolvePoolMax(bad, true)).toBe(DEFAULT_PROD_POOL_MAX);
    }
  });
});

describe("isTransactionPoolerUrl", () => {
  it("recognises the Supabase transaction pooler port", () => {
    expect(
      isTransactionPoolerUrl("postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres"),
    ).toBe(true);
  });

  it("rejects session-mode and direct connections", () => {
    expect(isTransactionPoolerUrl("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres")).toBe(false);
    expect(isTransactionPoolerUrl("postgresql://u:p@db.abc.supabase.co:5432/postgres")).toBe(false);
  });

  it("handles percent-encoded passwords and unparseable input", () => {
    expect(isTransactionPoolerUrl("postgresql://u:p%40ss@host.example:6543/postgres")).toBe(true);
    expect(isTransactionPoolerUrl("not a url")).toBe(false);
  });
});
