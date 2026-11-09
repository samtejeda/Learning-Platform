import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// Guards the YouTube embed's CSP additions: exactly the two origins the
// player needs, and nothing else broadened.
async function headerValue(key: string): Promise<string> {
  const groups = await nextConfig.headers!();
  const all = groups.find((g) => g.source === "/(.*)")!.headers;
  return all.find((h) => h.key === key)!.value;
}
const directive = (csp: string, name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("security headers (YouTube embed)", () => {
  it("frames only the privacy-enhanced YouTube host", async () => {
    const csp = await headerValue("Content-Security-Policy-Report-Only");
    expect(directive(csp, "frame-src")).toBe("frame-src https://www.youtube-nocookie.com");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("adds exactly one script origin for the IFrame API, and no other directive gains YouTube/Google hosts", async () => {
    const csp = await headerValue("Content-Security-Policy-Report-Only");
    expect(directive(csp, "script-src")).toContain("https://www.youtube.com");
    expect(directive(csp, "script-src")).not.toMatch(/ytimg|google|gstatic|\*/);
    for (const name of ["default-src", "style-src", "img-src", "media-src", "connect-src", "font-src", "object-src", "base-uri", "form-action"]) {
      expect(directive(csp, name), name).not.toMatch(/youtube|ytimg|google|gstatic/);
    }
  });

  it("keeps the Referrer-Policy YouTube requires, and lets only the embed use fullscreen", async () => {
    expect(await headerValue("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const perms = await headerValue("Permissions-Policy");
    expect(perms).toContain('fullscreen=(self "https://www.youtube-nocookie.com")');
    expect(perms).toContain("camera=()");
  });
});
