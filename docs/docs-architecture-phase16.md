# Phase 16.1 Docs Architecture

Status: Main implementation gate remediated; final certification is deferred to Prompt 2.

## Ownership

Docs are Workspace-owned operational data. `docs`, `doc_folders`, versions, access rows, comments, mentions, favorites, shares, and doc attachments all store `workspace_id` and derive Agency and Super Agency lineage through `Workspace -> Agency -> SuperAgency`.

The Docs schema does not add `agency_id`, `super_agency_id`, or Organization ownership to Doc rows.

## Parent Oversight

Agency and Super Agency oversight is read-only and limited to `WORKSPACE` visibility Docs in descendant Workspaces. Parent oversight endpoints return safe metadata, author display, and structured content for a read-only text preview/detail. They do not expose comments, version history, ACLs, internal membership lists, public share settings, attachment rows, signed URLs, file secrets, or private/selected-member Docs.

Parent actors cannot edit Docs, restore versions, comment, manage shares, or generate attachment URLs.

Parent UI routes are:

- `/agency/docs`
- `/super-agency/docs`

Both pages use bounded backend pagination and scope-specific query keys.

## Visibility And ACL

Base visibility values are:

- `PRIVATE`: creator and explicit ACL members.
- `SELECTED_MEMBERS`: explicit WorkspaceMembership ACL.
- `WORKSPACE`: active Workspace members with Docs permissions.

Public access is never implied by Doc ID or `WORKSPACE` visibility. Public read requires an active `DocShare` token.

## Editor Storage

The canonical content field is structured Tiptap/ProseMirror JSON. The API validates JSON size, rejects unsafe script/event/javascript URL content, and stores no arbitrary unsanitized HTML as database authority.

Rendered public HTML is generated from structured JSON and sanitized again before display.

Content size limit: 768 KiB serialized JSON per Doc revision.

## Autosave And Concurrency

The Workspace UI uses debounced autosave and sends `expectedRevision` with every content update. The API rejects stale saves with `DOC_VERSION_CONFLICT`; the UI exposes a conflict state with reload and draft-copy actions. Phase 16.1 does not attempt automatic JSON merge.

## Version Strategy

`Doc.content` holds the latest autosaved state and `content_revision` is incremented on each accepted update. `DocVersion` stores immutable snapshots on create, before restore, and at a bounded autosave interval so normal typing does not create a permanent version per keystroke.

Restoring a version creates a new current revision and preserves historical versions.

## Tree, Folders, Templates, Favorites

Folders and nested pages are Workspace-scoped. Service validation prevents cross-Workspace parents, self-parenting, cycles, and nesting beyond the centralized depth limit.

Templates use `Doc.type = TEMPLATE`; creating from a template creates an independent new `PAGE`.

Favorites are scoped to `WorkspaceMembership + Doc` and are not global user state.

## Comments And Mentions

Comments are Workspace operational data and are not exposed through parent oversight or public shares. Comment anchors use optional JSON block/node metadata rather than fragile character offsets.

Mentions are validated server-side against active WorkspaceMembership rows. Mention notifications reuse the existing notification system with dedupe keys; no duplicate notification engine or mail engine was added.

## Assets And Attachments

Docs reuse the canonical `Asset` model through `DocAttachment`. Uploads continue through the existing Files/Assets upload path, storage quota, commercial file entitlement checks, reservations, and bounded signed URL service.

Doc attachment download first authorizes the Doc, then verifies the attachment relationship and same Workspace Asset before issuing a short-lived URL. Public share attachment access is share-bound and only works for assets explicitly attached to the shared Doc.

Parent oversight receives no attachment signed URLs.

## Public Shares

`DocShare` stores a SHA-256 token hash only. The plaintext token is returned only on creation. Public lookup hashes the opaque URL token and resolves an active, unexpired, non-revoked share.

Optional passwords use the approved repository password hash primitive. Password attempts are rate limited in the API process. Passwords are never placed in the URL; successful verification returns a short-lived access verifier.

Revocation stops new share reads immediately. Previously issued storage signed URLs expire by their bounded TTL.

Public shares do not expose comments, versions, ACLs, internal membership IDs, audit logs, tenant financial metadata, or generic Workspace assets. Public pages should be treated as noindex surfaces by deployment/router policy.

Share create, revoke, and regenerate are audited without plaintext token, token hash, password, password hash, content, signed URL, or authorization-header metadata.

## AuditLog And Activity Log

AuditLog covers meaningful sensitive or administrative Docs changes: folder creation, Doc creation, ACL replacement, archive, restore, version restore, share creation, share revocation, and share regeneration. Autosave/content updates are not audited per keystroke.

Activity Log: NOT APPLICABLE / DEFERRED TO EXISTING ACTIVITY ARCHITECTURE.

Reason: this repository does not currently expose a generic Workspace ActivityLog service contract for new operational modules. Existing Project, Task, and Ticket activity views are domain-specific projections backed by `AuditLog` queries and safe metadata serializers. Phase 16.1 therefore does not invent a second activity system for Docs. Docs uses `AuditLog` for sensitive/admin events and defers a user-facing Docs activity stream until the existing activity architecture has a generic module contract or a dedicated Docs activity requirement.

## Permissions

Workspace Docs permissions are explicit:

- `docs.view`
- `docs.create`
- `docs.edit`
- `docs.manage`
- `docs.share.manage`
- `docs.versions.view`
- `docs.versions.restore`
- `docs.comments.view`
- `docs.comments.create`
- `docs.comments.update_own`
- `docs.comments.moderate`

Parent oversight uses only `docs.parent.read`.

## Commercial Compatibility

Docs were not added as a Phase 15 commercial entitlement key in this pass, so no published plan economics were changed. Attachments and image uploads remain subject to existing `files.enabled`, storage allocation, and restricted-mode write blocking through the canonical Files/Assets paths.

Restricted commercial mode continues to be enforced by the existing PermissionGuard for Docs write routes.

## Main-Gate Test Evidence

Dedicated Docs backend tests cover Workspace ownership, cross-Workspace denial, private/selected/workspace visibility, ACL membership validation, folders, nested page parents, cycle/depth validation, structured editor validation, XSS/link/HTML rejection, content size, autosave revision conflicts, version restore, comments, mentions, notification dedupe, templates, favorites, archive/restore, attachment authorization, parent attachment privacy, public share token/password/expiry/revocation/regeneration privacy, public attachment security, parent oversight query fencing, AuditLog, and logging redaction.

Dedicated Docs frontend tests cover the Workspace Docs route, list/tree selection, editor toolbar mounting, autosave saving/saved/failure/conflict states, true tenant-switch late responses, rapid switching, pending autosave switch/logout cleanup, parent Agency and Super Agency read-only UI, query key isolation, noindex public metadata, theme compatibility, i18n navigation labels, accessibility labels, and responsive grid constraints at component level.

## Real-Time Collaboration

Google-Docs-style simultaneous character-level editing is deferred. Phase 16.1 does not implement WebSocket CRDT, Yjs, Operational Transform, live cursors, or presence.

## Deferred

Forms, Goals, and final certification were not started. Prompt 2 owns clean migration verification, legacy/current upgrade verification, full integration, worker integration, E2E, build, audit, final git diff certification, and complete Phase 1-15 regression certification.
