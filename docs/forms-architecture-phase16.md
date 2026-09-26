# Phase 16.2 Forms Architecture

Status: COMPLETE / PASS.

Phase 16.2 adds Workspace-owned Forms, immutable published versions, public/internal rendering, submissions, and `FORM_SUBMITTED` automation integration. It does not start Phase 16.3 Goals or Phase 16.4 final certification.

## Ownership And Scope

- Workspace owns Forms, FormVersions, FormSubmissions, and FormSubmissionAsset links.
- Agency and Super Agency routes provide metadata-only oversight. They do not expose submitted answers.
- Organization remains legacy metadata only and has no Forms authority.
- Shared development database remains read-only for this phase.

## Data Model

- `Form`: Workspace-owned draft/published/archive root with stable `publicId`.
- `FormVersion`: immutable published snapshots; draft updates reuse the active draft and publish archives prior published versions.
- `FormSubmission`: durable answer record tied to the exact published version.
- `FormSubmissionAsset`: file/signature answer links to existing `Asset` rows. Forms do not create a second storage system.
- Migration: `0082_phase16_2_forms_foundation`.

## Builder And Validation

- Field catalog includes text, textarea, number, email, phone, date, dropdown, multi-select, checkbox, radio, rating, file upload, signature, and hidden fields.
- Field IDs and option IDs are stable, bounded, and regex validated.
- Schemas, settings, fields, steps, options, labels, and JSON size are bounded.
- Conditional logic uses allowlisted operators only and rejects dependency cycles.
- Submission validation rejects unknown fields, validates active required fields server-side, and strips inactive conditional answers.
- Success redirects allow relative paths and HTTPS only.

## Public Forms

- Public route: `/forms/:publicId`.
- Public pages are noindex.
- Anonymous public submissions are rate-limited and blocked in restricted billing mode.
- Honeypot spam rejection is server-side.
- CAPTCHA has a provider boundary but no live external provider in this main implementation; required CAPTCHA fails closed at final submission.

## Files And Signatures

- File and signature answers reference existing Asset rows in the same Workspace.
- Accepted assets must be `READY` and active/downloadable lifecycle.
- Public anonymous upload authorization uses the existing Asset authority. Forms do not create a second storage system, quota system, anonymous Workspace upload API, or object-key authority.
- Public upload endpoints are `/forms/:publicId/uploads/authorize` and `/forms/:publicId/uploads/complete`.
- The server derives Workspace, Form, current published FormVersion, field, owner membership, storage key, upload expiry, and quota from the public Form. Clients cannot choose Workspace, owner, FormVersion, object key, quota, or storage location.
- Authorization is allowed only for published public Forms and upload-capable fields (`FILE_UPLOAD` and `SIGNATURE`) in the current published version. Draft, archived, unavailable, wrong-version, wrong-field, and restricted-mode requests are rejected with privacy-preserving public errors.
- Each authorization creates a normal `Asset` in `UPLOADING` state plus a `StorageUploadReservation`, uses the existing MinIO presigned upload path, and stores only a SHA-256 hash of the public upload token in `Asset.metadata.publicFormUpload`.
- Public upload tokens are high-entropy, short-lived, single-purpose, and bound to Workspace, Form, public ID, FormVersion ID/number, field ID, client fingerprint hash, MIME, size, and Asset ID.
- Public upload completion verifies the uploaded object is owned by the reserved Asset key, matches the reserved size/MIME constraints, consumes the existing storage reservation, and marks the Asset `READY`.
- Final public submission validates every Asset against Workspace, Form, FormVersion, field, unexpired token hash, unconsumed metadata, status, lifecycle, MIME/size/count field constraints, and duplicate relation rules before linking it to `FormSubmissionAsset`.
- Submission creation and public upload consumption happen in one database transaction. Idempotent retries return the prior submission receipt before revalidating consumed upload tokens.
- Signature answers use the same upload flow as files, constrained to bounded image blobs (`image/png` / `image/webp`) and stored as Asset references, not base64/data URLs.
- Abandoned public uploads remain ordinary unconsumed upload reservations and are released by the existing storage retention cleanup path.
- Public upload authorization has a separate public rate limit in addition to final submission rate limiting.
- Parent Forms oversight remains metadata-only and does not expose answer values, Asset IDs, upload tokens, or file links.
- No signed download route is exposed for public uploads in Phase 16.2.
- No malware scanning adapter is introduced in Phase 16.2.

## Automation

- Existing automation enums are extended with `FORM_SUBMITTED` and `FORM_SUBMISSION`.
- Forms reuse `AutomationDomainEventsService`; no second automation engine is created.
- Submission persistence happens before automation capture.
- Automation payloads are PII-redacted and include form/submission metadata, not answer values.
- Automation capture failures do not roll back a durable submission; the submission records failure state.

## Commercial Entitlement

- Phase 15.3 has no Forms plan feature key.
- Forms are documented as `NOT-COMMERCIALLY-GATED` in the feature enforcement matrix.
- Existing restricted-mode write blocking, Files storage quotas, and Automation quotas remain authoritative.

## UI

- Workspace route: `/workspace/forms`.
- Parent routes: `/agency/forms`, `/super-agency/forms`.
- Public route: `/forms/:publicId`.
- Workspace UI includes form list, builder, field palette, preview/internal renderer, submissions, templates, and public link state.
- Query keys include tenant scope to preserve tenant switch isolation.

## Deferred To Final Verification / Remediation

- Live CAPTCHA provider adapter wiring.

## Final Certification Evidence

- Migration inventory: 82 migrations; latest `0082_phase16_2_forms_foundation`; no `0083`.
- Clean migration compatibility: PASS through 82 migrations on `zea_play_phase14613_clean`.
- Legacy migration compatibility: PASS through 82 migrations on `zea_play_phase14613_legacy`.
- Populated Phase 15.2 upgrade compatibility: PASS through 82 migrations; no automatic Forms, allocation, usage, or invoice projection rows were created.
- Seed idempotency: PASS; compatibility harness ran seed twice on the clean scratch database.
- Shared development database: READ ONLY; status check reported pending `0081_phase16_1_docs_foundation` and `0082_phase16_2_forms_foundation`; no shared-dev migration was applied.
- Focused Forms backend/public upload/feature matrix: PASS, 2 suites / 11 tests.
- Focused Docs, Phase 15, and gamification API regression: PASS, 9 suites / 188 tests.
- Focused Forms frontend/web stability: PASS, 23 files / 199 tests.
- Root unit suite: PASS, 17 tasks; API 59 suites / 586 tests; worker 8 suites / 28 tests; web 23 files / 199 tests.
- Integration suite: PASS, 8 tasks; API 6 suites / 109 tests; worker 8 suites / 28 tests.
- E2E suite: PASS, 21 tests.
- Build: PASS, 11 tasks; known Next.js ESLint plugin warning only.
- Audit: PASS at high threshold; two moderate advisories remain.
- `git diff --check`: PASS; Windows LF/CRLF warnings only.
- CAPTCHA external verification: NOT EXTERNALLY VERIFIED.
- Malware scanning: NOT IMPLEMENTED / NOT CLAIMED.
