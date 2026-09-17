# Security and RLS

**Owning agent:** `auth-access-builder` (paired with `auth-and-permissions.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's security setup and check the following. For each one, tell me pass or fail with a specific example:

- **RLS policies:** Is Row-Level Security enabled on every table with user data? Do the policies correctly restrict each user to their own rows?
- **Secrets management:** Are there any API keys, database passwords, or tokens hardcoded in the source code instead of environment variables?
- **HTTPS:** Are all connections encrypted? Are there any HTTP URLs or mixed-content warnings?
- **Input sanitization:** Are user inputs validated and sanitized before being used in database queries or rendered on pages?
- **CORS configuration:** Is the app's CORS policy restricted to only the domains it should accept requests from?
- **Authentication and authorization:** Does every API endpoint verify the user's identity and check their permissions before returning data?
- **Security headers:** Are headers like Content-Security-Policy, X-Frame-Options, and Strict-Transport-Security present?

Give me an overall score out of 7 and list the top 3 security issues to fix first.
