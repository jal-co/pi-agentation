# Changelog

## 0.1.1

- Updated Pi type imports and peer dependency for the `@earendil-works/pi-coding-agent` package scope introduced by Pi's package rename.

## 0.1.0

- Initial release.
- Local webhook server that accepts Agentation `submit` and MCP action payloads.
- Forwards incoming prompts into Pi via `pi.sendUserMessage(...)`.
- Queues messages as follow-ups when Pi is already busy.
- Built-in deduplication window for duplicate webhook submissions.
- Commands: `/agentation-start`, `/agentation-stop`, `/agentation-status`.
