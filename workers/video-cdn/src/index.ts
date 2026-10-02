import { handleRequest, type Env } from "./handler";

// Minimal local typings so the repo's tsc needs no Cloudflare types package.
declare const caches: { default: { match(k: Request): Promise<Response | undefined>; put(k: Request, r: Response): Promise<void> } };
type Ctx = { waitUntil(p: Promise<unknown>): void };

const worker = {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    return handleRequest(req, env, {
      cache: caches.default,
      fetchOrigin: (url, init) => fetch(url, init),
      waitUntil: (p) => ctx.waitUntil(p),
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  },
};

export default worker;
