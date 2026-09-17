# Availability and Recovery

**Owning agent:** `resilience-builder` (paired with `rate-limiting.md`, `caching-and-cdn.md`, `load-balancing-and-scaling.md`, `error-tracking-and-logs.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's availability and recovery setup and check the following. For each one, tell me pass or fail with a specific example:

- **Uptime monitoring:** Is a monitoring service actively checking my app and alerting me when it goes down, or could my app be offline right now without anyone knowing?
- **Health checks:** Does my app have a health check endpoint that verifies the app and its dependencies (database, external APIs) are actually working—not just that the server responds?
- **Database backups:** Are automated backups running on a regular schedule, stored in a different location from my primary database?
- **Backup testing:** Has a backup been successfully restored at least once to verify the backup process actually works?
- **Deployment rollback:** Can I quickly roll back to the previous version of my app if a deployment breaks something?
- **Recovery documentation:** Is there a written recovery plan or runbook that lists step-by-step instructions for common failure scenarios?

Give me an overall score out of 6 and list the top 3 things to fix first.
