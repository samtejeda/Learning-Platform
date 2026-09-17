# Error Tracking and Logs

**Owning agent:** `resilience-builder` (paired with `rate-limiting.md`, `caching-and-cdn.md`, `load-balancing-and-scaling.md`, `availability-and-recovery.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's error tracking and logging setup and check the following. For each one, tell me pass or fail with a specific example:

- **Error tracking integration:** Is an error tracking service (like Sentry) connected and capturing errors automatically, or are errors happening silently?
- **Error boundaries:** Are error boundaries set up so users see a friendly message instead of a blank screen when something crashes?
- **Logging quality:** Are logs structured with consistent fields (user ID, action, timestamp, severity) or are they unstructured console.log statements?
- **Alerting configuration:** Are alerts configured so critical errors trigger immediate notifications, or is there no alerting set up?
- **Source maps:** Are source maps configured so error reports show readable file names and line numbers instead of minified code?
- **Sensitive data protection:** Are logs and error reports free of passwords, tokens, credit card numbers, and other sensitive data?

Give me an overall score out of 6 and list the top 3 things to fix first.
