# Load Balancing and Scaling

**Owning agent:** `resilience-builder` (paired with `rate-limiting.md`, `caching-and-cdn.md`, `error-tracking-and-logs.md`, `availability-and-recovery.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's load balancing and scaling setup and check the following. For each one, tell me pass or fail with a specific example:

- **Load balancing:** Is my app configured to distribute traffic across multiple copies, or is everything running on a single instance?
- **Auto-scaling:** Is auto-scaling configured with sensible minimum and maximum limits and a clear trigger (like CPU usage or request count)?
- **Health checks:** Does my load balancer have health check endpoints that automatically remove unhealthy copies from rotation?
- **Session management:** Is user session data stored in a shared store (like Redis) so it works across multiple app copies, or is it stuck on individual servers?
- **Database connections:** Is connection pooling configured so my app doesn't overwhelm the database with too many simultaneous connections?
- **Database scaling:** Are read replicas set up to handle read-heavy traffic, or is my single database handling everything?

Give me an overall score out of 6 and list the top 3 things to fix first.
