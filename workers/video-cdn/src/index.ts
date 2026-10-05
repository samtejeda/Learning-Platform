import { handleRequest, type Env } from "./handler";

// Minimal local typings so the repo's tsc needs no Cloudflare types package.
declare const caches: { default: { match(k: Request): Promise<Response | undefined>; put(k: Request, r: Response): Promise<void> } };
type Ctx = { waitUntil(p: Promise<unknown>): void };

const worker = {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    // Trim: a secret piped in from a file can carry a trailing newline.
    return handleRequest(req, { ...env, VIDEO_CDN_HMAC_SECRET: env.VIDEO_CDN_HMAC_SECRET.trim() }, {
      cache: caches.default,
      fetchOrigin: (url, init) => fetch(url, init),
      waitUntil: (p) => ctx.waitUntil(p),
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  },
};

export default worker;
