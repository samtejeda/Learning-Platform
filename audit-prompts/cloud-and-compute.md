# Cloud and Compute

**Owning agent:** `platform-ops-builder` (paired with `hosting-and-deployment.md`, `cicd-and-version-control.md`)

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's cloud and compute setup and check the following. For each one, tell me pass or fail with a specific example:

- **Cost efficiency:** Are there any functions, queries, or API calls that run more frequently than necessary, and could caching or batching reduce the compute cost?
- **Resource sizing:** Is the app using more compute power or memory than it actually needs, or is it under-provisioned and at risk of slowdowns?
- **Serverless configuration:** Are serverless function timeouts, memory limits, and concurrency settings appropriate for the workload?
- **Data transfer:** Are there large assets (images, videos, files) being served directly from the compute layer instead of through a CDN?
- **Scaling readiness:** If traffic increased 10x, which parts of the infrastructure would fail first, and what would need to change?
- **Billing visibility:** Are there billing alerts, budget limits, or cost monitoring dashboards set up to catch spending anomalies?

Give me an overall score out of 6 and list the top 3 things to fix first.
