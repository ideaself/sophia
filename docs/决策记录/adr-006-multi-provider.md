# ADR-006: Multi-Provider LLM Support

## Status
Accepted

## Date
2026-07-29

## Context

Sophia initially launched with DeepSeek-only support (ADR-001). User feedback and practical usage revealed several limitations:

1. DeepSeek API outages or rate limits (429) block all classroom activity.
2. Different providers offer different strengths — DeepSeek for general chat, Mimo for budget-friendly summarization.
3. Users may already have API keys for other OpenAI-compatible providers.

## Decision

Add a multi-provider management layer that supports any OpenAI-compatible API:

- Provider registry with CRUD (create, read, update, delete)
- Each provider stores: name, base URL, selected model, encrypted API key
- One active provider at a time (selected in settings UI)
- Default fallback: DeepSeek (`deepseek-v4-flash`, `https://api.deepseek.com`)
- Provider store uses `safeStorage` for key encryption

## Alternatives Considered

### Stay DeepSeek-only
- Pros: No abstraction overhead.
- Cons: Single point of failure; users cannot choose cheaper/better models.
- Rejected: Blocking user from their own API keys is overly restrictive.

### Full provider abstraction with fallback chains
- Pros: Automatic failover, load balancing.
- Cons: Over-engineered for a single-user tool; adds complexity to streaming IPC.
- Rejected: Simple active-provider model is sufficient.

## Consequences

- `ProviderStore` manages provider profiles and encrypted keys.
- Streaming and non-streaming chat both read from the active provider.
- Artifact generation also uses the active provider.
- ADR-001 is superseded — DeepSeek is no longer the only option.
- Settings UI gains a provider management section.
- Backward compatible: existing DeepSeek config is auto-migrated to a provider entry.
