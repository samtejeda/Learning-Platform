# Database and Storage

**Owning agent:** `database-builder`

Status: active — build to this and self-check against it. Re-read this file fresh before every check; don't rely on memory of what it says.

Review my app's database and storage setup and check the following. For each one, tell me pass or fail with a specific example:

- **Schema design:** Are my tables logically organized with appropriate data types, required fields, and clear naming conventions?
- **Relationships:** Are related tables properly connected with foreign keys—and are there rules for what happens when a parent record is deleted?
- **Unique constraints:** Are there constraints preventing duplicate records where duplicates shouldn't exist (like duplicate email addresses or duplicate order numbers)?
- **Indexes:** Are commonly searched and filtered columns indexed for fast lookups—especially as data grows?
- **File storage:** Are uploaded files (images, documents, videos) stored in a proper file storage service instead of directly in the database?
- **Backups:** Is there an automated backup system in place, and has a restore been tested successfully?

Give me an overall score out of 6 and list the top 3 things to fix first.
