# APIs and Backend Logic

**Owning agent:** `backend-builder`

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's backend API and check the following. For each one, tell me pass or fail with a specific example:

- **Endpoint organization:** Are my API endpoints logically organized with consistent naming and proper HTTP methods (GET, POST, PUT, DELETE)?
- **Error handling:** Does every endpoint handle errors gracefully—returning helpful error messages with correct status codes instead of crashing silently?
- **Input validation:** Does every endpoint check incoming data before processing it—rejecting missing fields, wrong data types, and invalid values?
- **Authentication:** Are protected endpoints properly checking that the user is logged in and authorized before allowing the action?
- **Response quality:** Are responses returning only the data the frontend needs—not leaking sensitive fields like passwords, internal IDs, or private user data?
- **Performance:** Are there any endpoints that will be slow under load—missing pagination, loading too much data at once, or making unnecessary database calls?

Give me an overall score out of 6 and list the top 3 things to fix first.
