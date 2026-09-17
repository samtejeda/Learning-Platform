# Hosting and Deployment

**Owning agent:** `platform-ops-builder` (paired with `cloud-and-compute.md`, `cicd-and-version-control.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's hosting and deployment setup and check the following. For each one, tell me pass or fail with a specific example:

- **Environment variables:** Are all secrets stored in the hosting platform's environment variable settings, with nothing hardcoded in the source code?
- **SSL and HTTPS:** Does the live site load with https and show a valid SSL certificate with no mixed-content warnings?
- **Build process:** Does the build complete without errors, and are there any unnecessary steps slowing it down?
- **Domain configuration:** Is the custom domain properly configured with correct DNS records and no redirect loops?
- **Deployment pipeline:** Is the deploy connected to the GitHub repo with automatic deploys on push, and is there a preview deployment setup for pull requests?
- **Rollback readiness:** Can the site be reverted to the previous deploy with one click or one command, and has this been tested?

Give me an overall score out of 6 and list the top 3 things to fix first.
