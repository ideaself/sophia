# ADR-008: JSONL Append-Only Message Storage

## Status
Accepted

## Date
2026-07-29

## Context

The original message storage (ADR-002) used a single JSON array in `messages.json`:

```json
[{ "id": "msg1", "role": "user", "content": "..." }, { "id": "msg2", "role": "assistant", "content": "..." }]
```

Every `addMessage()` call must:
1. Read the entire file into memory.
2. Parse the full JSON array.
3. Append the new message.
4. Write the entire array back.

This is O(n²) as the conversation grows — each new message rewrites the entire history. For long learning sessions (1000+ messages), this causes noticeable I/O lag.

## Decision

Change message storage to JSONL (JSON Lines) format:

- Each message is a single JSON object on its own line.
- `addMessage()` appends a line using `appendFile` — O(1) per write.
- `getMessages()` reads line-by-line and parses each line — O(n) sequential read.
- `updateMessage()` / `deleteMessage()` still require full rewrite, but these are rare operations.

## Format

```
{"id":"msg1","role":"user","content":"..."}
{"id":"msg2","role":"assistant","content":"..."}
```

## Migration

- `getMessages()` first attempts JSONL parsing (line-by-line).
- If that fails, it falls back to legacy JSON array parsing.
- This ensures backward compatibility with existing conversations.

## Alternatives Considered

### Keep JSON array (status quo)
- Pros: Simple, no migration needed.
- Cons: O(n²) write cost; noticeable lag with long conversations.
- Rejected: Performance degradation is unacceptable.

### SQLite
- Pros: Efficient queries, indexing, search.
- Cons: Added dependency; overkill for linear message access pattern; product spec explicitly stated "第一版可用单个 messages.jsonl".
- Deferred: Can be introduced later if search/query needs grow.

## Consequences

- `addMessage()` is now O(1) — no more rewrite of entire history.
- `getMessages()` is O(n) — comparable to JSON parse.
- `updateMessage()` / `deleteMessage()` still O(n) but rarely called.
- Backward compatible — old `messages.json` files are still readable.
- No migration script needed — handled transparently in `getMessages()`.
