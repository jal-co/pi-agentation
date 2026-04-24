# Changelog

## 0.1.0

- Initial release.
- Local webhook server that accepts Agentation `submit` and MCP action payloads.
- Forwards incoming prompts into Pi via `pi.sendUserMessage(...)`.
- Queues messages as follow-ups when Pi is already busy.
- Built-in deduplication window for duplicate webhook submissions.
- Commands: `/agentation-start`, `/agentation-stop`, `/agentation-status`.
