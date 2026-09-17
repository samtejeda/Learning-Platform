# Caching and CDN

**Owning agent:** `resilience-builder` (paired with `rate-limiting.md`, `load-balancing-and-scaling.md`, `error-tracking-and-logs.md`, `availability-and-recovery.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's caching and performance setup. For each item, tell me pass or fail with a specific example:

- **Image optimization:** Are all images served in modern formats (WebP/AVIF), properly sized for their display dimensions, and lazy loaded below the fold?
- **CDN configuration:** Are static assets being served from a CDN with appropriate cache headers? Check response headers for CDN indicators.
- **Cache headers:** Do static files (CSS, JS, fonts, images) have long cache lifetimes with cache-busting on deploy?
- **Dynamic content caching:** Are frequently-accessed database queries or API responses being cached, with a clear invalidation strategy?
- **Performance metrics:** What is the current Lighthouse performance score and Largest Contentful Paint (LCP) time?
- **Font loading:** Are web fonts loaded efficiently (preloaded, display:swap) so they don't block page rendering?
- **Code splitting:** Is the app loading only the code needed for the current page, or downloading everything upfront?

Give me an overall score out of 7 and list the top 3 performance improvements to make first.
