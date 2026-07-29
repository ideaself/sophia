# ADR-007: WebDAV Sync for Cross-Device Data Portability

## Status
Accepted

## Date
2026-07-29

## Context

Sophia-Local is a local-first desktop app (ADR-002). As the user began using it on multiple machines, the need to transfer learning data (conversations, textbooks, flashcards) between devices became apparent.

Manual USB/cloud copy is error-prone and inconvenient. A cloud-sync solution was needed that preserves the local-first principle: the local copy is always primary and fully functional offline.

## Decision

Add WebDAV sync as the official data synchronization mechanism:

- Uses standard WebDAV protocol (RFC 4918) — no custom server.
- Syncs the entire `{appData}/Sophia-Local` data directory.
- Bidirectional sync with conflict resolution (last-write-wins by mtime).
- Incremental sync — only transfers changed files (based on mtime + size).
- Binary-safe — preserves PDF originals byte-for-byte.
- Credentials encrypted with `safeStorage`.
- WebDAV server URL, username, and password configured in settings UI.
- Sync is manual-trigger (push/pull buttons) — no background auto-sync.

## Sync Strategy

- **Push**: upload local files newer than server copy; delete server files that no longer exist locally.
- **Pull**: download server files newer than local copy; delete local files that no longer exist on server.
- **Safe mode**: push garbage-collects orphaned server files; pull never mirrors server junk.
- **Secrets excluded**: `.enc` key files are never synced.

## Alternatives Considered

### Cloud storage (Dropbox/Google Drive)
- Pros: Ubiquitous, easy setup.
- Cons: No standard API; requires OAuth; not self-hosted.
- Rejected: WebDAV is simpler and self-hostable.

### Custom sync server
- Pros: Full control over protocol.
- Cons: Requires server deployment and maintenance.
- Rejected: WebDAV is already available via NAS, Nextcloud, Synology, etc.

### No sync (manual copy)
- Pros: Simplest; no new code.
- Cons: User explicitly requested cross-device data portability.
- Rejected: Too inconvenient.

## Consequences

- ADR-004's "no cloud sync" position is partially superseded — sync exists but remains user-triggered.
- The app gains WebDAV server URL, credential UI, and sync status indicators.
- Sync is not real-time — user must explicitly push or pull.
- WebDAV library dependency added (`webdav` npm package).
- Sync excludes encrypted key files (`.enc`) and system metadata.
