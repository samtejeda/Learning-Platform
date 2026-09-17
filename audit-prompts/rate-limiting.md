# Rate Limiting

**Owning agent:** `resilience-builder` (paired with `caching-and-cdn.md`, `load-balancing-and-scaling.md`, `error-tracking-and-logs.md`, `availability-and-recovery.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's rate limiting and cost management setup. For each item, tell me pass or fail with a specific example:

- **Rate limits on expensive endpoints:** Are the endpoints that call paid APIs protected with rate limits? What are the current thresholds?
- **Billing alerts:** Are spending alerts configured on all paid API providers? What are the alert thresholds?
- **Debouncing:** Are API calls triggered by user input (search, autocomplete, filtering) debounced so they don't fire on every keystroke?
- **429 handling:** Does the app handle "Too Many Requests" responses gracefully—with retry logic, not just error messages?
- **API key management:** Are API keys stored securely and are separate keys used for development vs. production?
- **Usage monitoring:** Can you see API usage trends and cost data in a dashboard or logging system?
- **Cost per feature:** Can you estimate how much each API-dependent feature costs per user per month?

Give me an overall score out of 7 and list the top 3 cost risks to address first.
