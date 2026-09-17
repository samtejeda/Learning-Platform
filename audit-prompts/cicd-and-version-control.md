# CI/CD and Version Control

**Owning agent:** `platform-ops-builder` (paired with `hosting-and-deployment.md`, `cloud-and-compute.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my project's version control and CI/CD setup and check the following. For each one, tell me pass or fail with a specific example:

- **Commit hygiene:** Are commits small, frequent, and descriptively messaged—or are they large, infrequent dumps with vague labels?
- **Branch strategy:** Is the project using feature branches and pull requests, or is everything committed directly to the main branch?
- **Automated checks:** Are there any automated tests, linting, or build verifications running on pull requests or pushes?
- **Deployment pipeline:** Is the deploy connected to the repository with automatic deployment on merge, and is there a clear path from commit to production?
- **Security:** Are there any secrets, API keys, or credentials committed in the codebase or Git history?
- **Recovery readiness:** Can the project be reverted to a previous version quickly, and has this been tested?

Give me an overall score out of 6 and list the top 3 things to fix first.
