import { describe, expect, it } from "vitest";
import { parseYoutubeLink } from "./youtube";

const ID = "dQw4w9WgXcQ";
const ok = (input: unknown) => {
  const r = parseYoutubeLink(input);
  expect(r, String(input)).toEqual({ ok: true, videoId: ID });
};
const bad = (input: unknown) => {
  expect(parseYoutubeLink(input), String(input)).toEqual({ ok: false, reason: "invalid_link" });
};

describe("parseYoutubeLink: accepted links", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?feature=share&v=${ID}&si=abc123`,
    `https://www.youtube.com/watch?v=${ID}&list=PLabcdefghijklmnop&index=2`,
    `https://www.youtube.com/watch/?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}/`,
    `https://youtu.be/${ID}?si=abcdef&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=5&rel=0`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/v/${ID}`,
    `https://www.youtube.com/watch?v=${ID}#t=30`,
    `  https://youtu.be/${ID}  `,
  ])("%s", (input) => ok(input));

  it("keeps only the id (fragments, time and playlist params are dropped)", () => {
    expect(parseYoutubeLink(`https://youtu.be/${ID}?t=99&list=PLx`)).toEqual({ ok: true, videoId: ID });
  });

  it("accepts ids with - and _", () => {
    expect(parseYoutubeLink("https://youtu.be/a-b_c-d_e-f")).toEqual({ ok: true, videoId: "a-b_c-d_e-f" });
  });
});

describe("parseYoutubeLink: rejected input", () => {
  it("non-strings and empties", () => {
    for (const v of [undefined, null, 5, {}, [], "", "   ", "\n"]) bad(v);
  });

  it("a bare id or scheme-less link", () => {
    bad(ID);
    bad(`youtube.com/watch?v=${ID}`);
    bad(`www.youtube.com/watch?v=${ID}`);
    bad(`//www.youtube.com/watch?v=${ID}`);
  });

  it("non-https schemes", () => {
    bad(`http://www.youtube.com/watch?v=${ID}`);
    bad(`http://youtu.be/${ID}`);
    bad(`javascript:alert(1)//www.youtube.com/watch?v=${ID}`);
    bad(`javascript://www.youtube.com/%0aalert(1)/watch?v=${ID}`);
    bad(`data:text/html,https://youtu.be/${ID}`);
    bad(`ftp://youtu.be/${ID}`);
    bad(`file:///etc/passwd`);
    bad(`vbscript:msgbox(1)`);
    bad(`HTTP://youtu.be/${ID}`);
  });

  it("other hosts and look-alike hosts", () => {
    bad(`https://vimeo.com/watch?v=${ID}`);
    bad(`https://evil.com/watch?v=${ID}`);
    bad(`https://youtube.com.evil.com/watch?v=${ID}`);
    bad(`https://www.youtube.com.evil.com/watch?v=${ID}`);
    bad(`https://evilyoutube.com/watch?v=${ID}`);
    bad(`https://notyoutu.be/${ID}`);
    bad(`https://youtu.be.evil.com/${ID}`);
    bad(`https://evil.com/youtube.com/watch?v=${ID}`);
    bad(`https://evil.com/?u=https://youtu.be/${ID}`);
    bad(`https://youtube.com@evil.com/watch?v=${ID}`);
    bad(`https://www.youtube.com.@evil.com/watch?v=${ID}`);
    bad(`https://youtube.co/watch?v=${ID}`);
    bad(`https://youtube.com./watch?v=${ID}`);
    bad(`https://sub.www.youtube.com/watch?v=${ID}`);
    bad(`https://music.youtube.com/watch?v=${ID}`);
    bad(`https://studio.youtube.com/watch?v=${ID}`);
    bad(`https://youtu.be.${ID}`);
    bad(`https://yоutube.com/watch?v=${ID}`); // Cyrillic о
    bad(`https://www.youtube.com／watch?v=${ID}`); // fullwidth solidus
    bad(`https://ｙｏｕｔｕ.ｂｅ/${ID}`.replace("ｙｏｕｔｕ.ｂｅ", "youtu.be.evil.com"));
  });

  it("credentials, ports, IPs", () => {
    bad(`https://user:pass@www.youtube.com/watch?v=${ID}`);
    bad(`https://user@youtu.be/${ID}`);
    bad(`https://www.youtube.com:8443/watch?v=${ID}`);
    bad(`https://youtu.be:444/${ID}`);
    bad(`https://127.0.0.1/watch?v=${ID}`);
    bad(`https://[::1]/watch?v=${ID}`);
    bad(`https://localhost/watch?v=${ID}`);
    bad(`https://169.254.169.254/latest/meta-data`);
  });

  it("playlist-only, channel, search and other non-video pages", () => {
    bad(`https://www.youtube.com/playlist?list=PLabcdefghijklmnop`);
    bad(`https://www.youtube.com/watch?list=PLabcdefghijklmnop`);
    bad(`https://www.youtube.com/embed/videoseries?list=PLabcdefghijklmnop`);
    bad(`https://www.youtube.com/embed/videoseries`);
    bad(`https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv`);
    bad(`https://www.youtube.com/@somechannel`);
    bad(`https://www.youtube.com/results?search_query=${ID}`);
    bad(`https://www.youtube.com/`);
    bad(`https://youtu.be/`);
    bad(`https://youtu.be`);
    bad(`https://www.youtube.com/watch`);
    bad(`https://www.youtube.com/watch?v=`);
  });

  it("malformed ids", () => {
    bad(`https://youtu.be/${ID}x`); // 12
    bad(`https://youtu.be/${ID.slice(0, 10)}`); // 10
    bad(`https://youtu.be/dQw4w9WgXc!`);
    bad(`https://youtu.be/dQw4w9WgXc%20`);
    bad(`https://youtu.be/%64Qw4w9WgXcQ`); // encoded char: rejected rather than decoded
    bad(`https://www.youtube.com/watch?v=${ID}${ID}`);
    bad(`https://www.youtube.com/watch?v=${ID}%0a`);
    bad(`https://www.youtube.com/watch?v=<script>`);
    bad(`https://www.youtube.com/watch?v=../../etc/passwd`);
  });

  it("ambiguous or smuggled parameters and paths", () => {
    bad(`https://www.youtube.com/watch?v=${ID}&v=aaaaaaaaaaa`);
    bad(`https://youtu.be/${ID}/extra`);
    bad(`https://www.youtube.com/shorts/${ID}/extra`);
    bad(`https://www.youtube.com/embed/${ID}/extra`);
    bad(`https://www.youtube.com/watch/extra?v=${ID}`);
    bad(`https://www.youtube.com//shorts/${ID}`);
    bad(`https://youtu.be//${ID}`);
    bad(`https://www.youtube.com/redirect?q=https://youtu.be/${ID}`);
    bad(`https://www.youtube.com/attribution_link?u=/watch?v%3D${ID}`);
  });

  it("whitespace, control characters, backslashes and absurd length", () => {
    bad(`https://youtu.be/${ID}\n`.replace("\n", "\nhttps://evil.com"));
    bad(`https://youtu.be/${ID} https://evil.com`);
    bad(`https://youtu.be/${ID}\u0000`);
    bad(`https://youtu.be/\t${ID}`);
    bad(`https://youtu.be\\@evil.com/${ID}`);
    bad(`https://www.youtube.com\\watch?v=${ID}`);
    bad(`https://youtu.be/${ID}?${"a".repeat(400)}`);
    bad(`https://youtu.be/${ID.slice(0, 5)}\u2028${ID.slice(5)}`);
  });
});
