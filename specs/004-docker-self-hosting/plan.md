# Implementation plan

Use the existing Next 16/Prisma 7/Postgres stack and ATS adapters. Add `CollectionConfig`, `CollectionRun`, `Bootstrap`, `ResumeFile`; optional `ImportRun.idempotencyKey` and saved response. The worker compiles to JavaScript with esbuild and directly imports the shared application import service.

Store human-friendly preferences together with derived collector configuration, rebuilding rules only at validated configuration writes. Use IANA timezone calendar calculations for daily slots, a dedicated PostgreSQL session advisory lock for worker ownership and transaction locks for queue/import serialization. Save publication payload before importing so crashes can resume the same identity.

Reuse selected auth primitives from the auth worktree, integrate guards into each data/mutation surface, and implement the bootstrap in one transaction. Store passwords with scrypt and opaque sessions as hashes. Apply same-origin validation to browser mutations.

Extract PDF text with PDF.js, DOCX with Mammoth, and UTF-8 text directly; store managed file keys and confirmation state. Gemini tailoring receives confirmed candidate text, with no personal hardcoding or arbitrary user-supplied filesystem paths.

Build a separate Compose configuration and multi-stage Debian Node 22 image. Keep original launch scripts and Compose file intact. Health checks, non-root runtime, persistent DB/files volumes, consistent stopped-writer backup and empty-target restore form the operational path.

Validation combines pure unit cases, database integration tests, isolated container recovery tests and browser checks. Do not call paid model APIs or production imports. See `tasks.md` and `validation.md` for evidence and remaining work.
