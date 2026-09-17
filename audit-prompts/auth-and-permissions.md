# Auth and Permissions

**Owning agent:** `auth-access-builder` (paired with `security-and-rls.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's authentication and permissions system and check the following. For each one, tell me pass or fail with a specific example:

- **Authentication flow:** Is the login/signup system using a proven auth provider with proper password hashing, session management, and email verification?
- **Authorization enforcement:** Does every protected page and API endpoint check that the user is logged in AND authorized to perform the requested action?
- **Row-level security:** Can users only access their own data—or can a logged-in user see, edit, or delete records belonging to other users?
- **Session management:** Do sessions expire after a reasonable time, get invalidated on logout, and refresh securely?
- **Password reset security:** Do reset links expire quickly, work only once, and notify the account owner when their password is changed?
- **Protected routes:** Are all pages and endpoints that should require authentication actually gated—with no unprotected backdoors?

Give me an overall score out of 6 and list the top 3 things to fix first.
