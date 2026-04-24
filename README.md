# pi-agentation

A Pi extension that receives Agentation webhook payloads and turns them into
real Pi user messages.

Please note: this is a very early version. Pi did most of the coding.

## What it does

- starts a small local webhook server inside Pi
- accepts Agentation `submit` webhook payloads
- also accepts Agentation MCP-style action payloads with `output`
- forwards the formatted prompt into Pi with `pi.sendUserMessage(...)`
- uses `deliverAs: "followUp"` while Pi is busy

## Install

### From npm

```bash
pi install npm:@denniseijpe/pi-agentation
```

### From git

```bash
pi install git:github.com/denniseijpe/pi-agentation
```

## Usage

Start the listener manually inside Pi:

```bash
/agentation-start
```

Or provide a custom port:

```bash
/agentation-start 8080
```

Stop it when you are done:

```bash
/agentation-stop
```

## Configuration in your app

Environment variables:

- `PI_AGENTATION_HOST` default: `127.0.0.1`
- `PI_AGENTATION_PORT` default: `4761`
- `PI_AGENTATION_PATH` default: `/agentation`
- `PI_AGENTATION_TOKEN` optional shared token passed as `?token=...`

Example:

```bash
PI_AGENTATION_PORT=4761 pi
```

### Or using mise.toml

If you use [mise](https://mise.jdx.dev/), add this to your project's `mise.toml`:

```toml
[env]
PI_AGENTATION_PORT = "4761"
PI_AGENTATION_TOKEN = "your-secret-token"
```

This allows you to have seperate ports for different projects.

## Agentation setup

Install the [agentation package from npm](https://www.npmjs.com/package/agentation).

Point Agentation at:

```text
http://127.0.0.1:4761/agentation
```

If you enable a token (recommended):

```text
http://127.0.0.1:4761/agentation?token=your-secret-token
```

Example React usage (SPA):

```tsx
import { Agentation } from "agentation";

if (process.env.NODE_ENV === "development") {
	localStorage.setItem(
		"feedback-toolbar-settings",
		JSON.stringify({
			...JSON.parse(localStorage.getItem("feedback-toolbar-settings") ?? "{}"),
			webhooksEnabled: false,
			autoClearAfterCopy: true,
		}),
	);
}

export function App() {
  return (
    <>
      {/* your app */}
      <Agentation webhookUrl="http://127.0.0.1:4761/agentation?token=your-secret-token" />
    </>
  );
}
```

Example React usage (SSR / Next.js):

```tsx
import { useEffect } from "react";
import { Agentation } from "agentation";

function useAgentationSettings() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (process.env.NODE_ENV === "development")  {
      const raw = localStorage.getItem("feedback-toolbar-settings");
      const saved = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        "feedback-toolbar-settings",
        JSON.stringify({
          ...saved,
          webhooksEnabled: false,
          autoClearAfterCopy: true,
        }),
      );
    }
  }, []);
}

export function App() {
  useAgentationSettings();

  return (
    <>
      {/* your app */}
      <Agentation webhookUrl="http://127.0.0.1:4761/agentation?token=your-secret-token" />
    </>
  );
}
```

## Behavior

- If Pi is idle, the Agentation message is sent immediately.
- If Pi is busy, the message is queued with Pi's follow-up queue.
- Duplicate webhook submissions are ignored for a short dedupe window.

## Commands

| Command | Description |
|---------|-------------|
| `/agentation-start [port]` | Start the webhook listener (optional port) |
| `/agentation-stop` | Stop the webhook listener |
| `/agentation-status` | Show current listener status |

## Notes

- The server does **not** auto-start; run `/agentation-start` after loading Pi.
- The server binds to localhost by default.
- `annotation.add` and other non-`submit` toolbar events are ignored on purpose.
- This extension is focused on getting Agentation prompts into Pi, not on syncing replies back.
- If you switch or fork sessions, the listener stops with the old session. Re-run `/agentation-start` in the new session.
