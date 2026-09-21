// End-to-end check of the privacy policy through the REAL Sentry SDK: init it
// with our actual shared options and a fake in-memory transport (nothing
// leaves the machine), capture a maximally dirty event, and inspect exactly
// what would have been sent.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/nextjs";

type Sent = { event: Record<string, unknown> };
const sent: Sent[] = [];

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://examplekey@o0.ingest.us.sentry.io/0";
  const { sharedSentryOptions } = await import("./options");
  Sentry.init({
    ...sharedSentryOptions,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: true,
    defaultIntegrations: false,
    transport: () => ({
      // An envelope is [headers, items[]]; each item is [itemHeader, payload].
      send: async (envelope: unknown) => {
        for (const item of (envelope as [unknown, unknown[]])[1]) {
          const [header, payload] = item as [{ type?: string }, Record<string, unknown>];
          if (header.type === "event") sent.push({ event: payload });
        }
        return {};
      },
      flush: async () => true,
    }),
  });
});

afterAll(async () => {
  await Sentry.close();
});

describe("Sentry SDK with our shared options", () => {
  it("sends a readable, fully scrubbed event", async () => {
    Sentry.setUser({ id: "u-1", email: "kid@example.com", username: "kid", ip_address: "203.0.113.7" });
    Sentry.captureException(new Error("otp failed for kid@example.com +14015551234"), {
      extra: { password: "hunter2", note: "kept" },
    });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const json = JSON.stringify(sent[0].event);
    for (const leaked of ["hunter2", "kid@example.com", "+14015551234", "203.0.113.7", '"kid"']) {
      expect(json).not.toContain(leaked);
    }
    expect(sent[0].event.user).toEqual({ id: "u-1" });
    expect(json).toContain("[email]");
    expect(json).toContain("kept");
  });

  it("drops expected control-flow errors entirely", async () => {
    const before = sent.length;
    Sentry.captureException(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }));
    Sentry.captureException(Object.assign(new Error("Not allowed"), { name: "AuthError" }));
    await Sentry.flush(2000);
    expect(sent.length).toBe(before);
  });

  it("still reports genuine bugs", async () => {
    const before = sent.length;
    Sentry.captureException(new TypeError("x is not a function"));
    await Sentry.flush(2000);
    expect(sent.length).toBe(before + 1);
  });
});
