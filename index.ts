import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type JsonObject = Record<string, unknown>;

type NormalizedWebhookMessage = {
  annotationCount: number;
  fingerprint: string;
  kind: "action" | "submit";
  message: string;
};

type UIContext = {
  hasUI: boolean;
  ui: {
    notify: (message: string, severity: "info" | "warning" | "error") => void;
    setStatus: (key: string, value: string | undefined) => void;
  };
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/agentation";
const DEFAULT_PORT = 4761;
const DEDUPE_WINDOW_MS = 15_000;
const MAX_BODY_BYTES = 512 * 1024;
const STATUS_KEY = "pi-agentation";

const isJsonObject = (value: unknown): value is JsonObject => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const getString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const getArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PI_AGENTATION_PORT: ${value}`);
  }

  return port;
};

const parseCommandPort = (value: string | undefined): number | undefined => {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined;
  }

  return port;
};

const normalizePath = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_PATH;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const getConfig = (): {
  host: string;
  path: string;
  port: number;
  token: string | undefined;
} => {
  return {
    host: process.env.PI_AGENTATION_HOST?.trim() || DEFAULT_HOST,
    path: normalizePath(process.env.PI_AGENTATION_PATH),
    port: parsePort(process.env.PI_AGENTATION_PORT),
    token: process.env.PI_AGENTATION_TOKEN?.trim() || undefined,
  };
};

const formatWebhookUrl = (host: string, port: number, path: string): string => {
  return `http://${host}:${port}${path}`;
};

const buildFingerprint = (
  kind: "action" | "submit",
  output: string,
  sourceUrl: string | undefined,
  sessionId: string | undefined,
): string => {
  const hash = createHash("sha256");
  hash.update(kind);
  hash.update("\n");
  hash.update(output.trim());
  hash.update("\n");
  hash.update(sourceUrl ?? "");
  hash.update("\n");
  hash.update(sessionId ?? "");
  return hash.digest("hex");
};

const buildSubmitMessage = (payload: JsonObject): NormalizedWebhookMessage | null => {
  const event = getString(payload.event);
  if (event && event !== "submit") {
    return null;
  }

  const output = getString(payload.output)?.trim();
  if (!output) {
    return null;
  }

  const sourceUrl = getString(payload.url);
  const annotations = getArray(payload.annotations);
  const prefixLines = ["Agentation feedback received."];

  if (sourceUrl) {
    prefixLines.push(`URL: ${sourceUrl}`);
  }

  if (annotations.length > 0) {
    prefixLines.push(`Annotations: ${annotations.length}`);
  }

  prefixLines.push("", output);

  return {
    annotationCount: annotations.length,
    fingerprint: buildFingerprint("submit", output, sourceUrl, undefined),
    kind: "submit",
    message: prefixLines.join("\n"),
  };
};

const buildActionMessage = (payload: JsonObject): NormalizedWebhookMessage | null => {
  const output = getString(payload.output)?.trim();
  const sessionId = getString(payload.sessionId);
  if (!output || !sessionId) {
    return null;
  }

  const annotations = getArray(payload.annotations);
  const prefixLines = ["Agentation action request received.", `Session: ${sessionId}`];

  if (annotations.length > 0) {
    prefixLines.push(`Annotations: ${annotations.length}`);
  }

  prefixLines.push("", output);

  return {
    annotationCount: annotations.length,
    fingerprint: buildFingerprint("action", output, undefined, sessionId),
    kind: "action",
    message: prefixLines.join("\n"),
  };
};

const normalizePayload = (payload: unknown): {
  ignoredReason?: string;
  normalized?: NormalizedWebhookMessage;
} => {
  if (!isJsonObject(payload)) {
    return { ignoredReason: "Body must be a JSON object." };
  }

  const actionMessage = buildActionMessage(payload);
  if (actionMessage) {
    return { normalized: actionMessage };
  }

  const submitMessage = buildSubmitMessage(payload);
  if (submitMessage) {
    return { normalized: submitMessage };
  }

  const event = getString(payload.event);
  if (event && event !== "submit") {
    return { ignoredReason: `Ignoring Agentation event "${event}".` };
  }

  return {
    ignoredReason:
      "Payload did not match an Agentation submit or action request shape.",
  };
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    let settled = false;
    let body = "";
    let size = 0;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const succeed = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    req.setEncoding("utf8");

    req.on("data", (chunk: string) => {
      if (settled) {
        return;
      }

      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        fail(new Error("Request body too large."));
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      if (settled) {
        return;
      }

      if (body.trim() === "") {
        succeed({});
        return;
      }

      try {
        succeed(JSON.parse(body));
      } catch {
        fail(new Error("Invalid JSON body."));
      }
    });

    req.on("error", (error: Error) => {
      fail(error);
    });
  });
};

const sendJson = (
  res: ServerResponse,
  statusCode: number,
  body: JsonObject,
): void => {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
};

const maskToken = (token: string | undefined): string => {
  if (!token) {
    return "disabled";
  }

  if (token.length <= 4) {
    return "****";
  }

  return `${token.slice(0, 2)}***${token.slice(-2)}`;
};

export default function (pi: ExtensionAPI) {
  const config = getConfig();
  const recentFingerprints = new Map<string, number>();

  let isAgentBusy = false;
  let isListening = false;
  let lastError: string | undefined;
  let server: Server | undefined;
  let activePort = config.port;
  let webhookUrl = formatWebhookUrl(config.host, activePort, config.path);

  const pruneRecentFingerprints = (): void => {
    const now = Date.now();
    for (const [fingerprint, timestamp] of recentFingerprints.entries()) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        recentFingerprints.delete(fingerprint);
      }
    }
  };

  const rememberFingerprint = (fingerprint: string): boolean => {
    pruneRecentFingerprints();
    if (recentFingerprints.has(fingerprint)) {
      return false;
    }

    recentFingerprints.set(fingerprint, Date.now());
    return true;
  };

  const updateStatus = (ctx?: UIContext): void => {
    if (!ctx?.hasUI) {
      return;
    }

    if (isListening) {
      ctx.ui.setStatus(STATUS_KEY, `agentation ${config.host}:${activePort}`);
      return;
    }

    if (lastError) {
      ctx.ui.setStatus(STATUS_KEY, `agentation error: ${lastError}`);
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, "agentation: stopped");
  };

  const sendToPi = (message: string): "immediate" | "queued" => {
    if (!isAgentBusy) {
      try {
        pi.sendUserMessage(message);
        return "immediate";
      } catch {
        // A stream may have started between our state check and the send.
      }
    }

    pi.sendUserMessage(message, { deliverAs: "followUp" });
    return "queued";
  };

  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const method = req.method ?? "GET";
    const requestUrl = new URL(req.url ?? "/", webhookUrl);

    if (requestUrl.pathname !== config.path) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    if (config.token) {
      const providedToken =
        requestUrl.searchParams.get("token") ??
        requestUrl.searchParams.get("secret");
      if (providedToken !== config.token) {
        sendJson(res, 401, { error: "Invalid token." });
        return;
      }
    }

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      res.end();
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, {
        busy: isAgentBusy,
        ok: true,
        path: config.path,
        token: maskToken(config.token),
        webhookUrl,
      });
      return;
    }

    if (method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const { ignoredReason, normalized } = normalizePayload(payload);

      if (!normalized) {
        sendJson(res, 202, {
          ignored: true,
          message: ignoredReason ?? "Ignored payload.",
          ok: true,
        });
        return;
      }

      if (!rememberFingerprint(normalized.fingerprint)) {
        sendJson(res, 200, {
          duplicate: true,
          kind: normalized.kind,
          ok: true,
        });
        return;
      }

      const delivery = sendToPi(normalized.message);
      sendJson(res, 202, {
        annotationCount: normalized.annotationCount,
        delivery,
        kind: normalized.kind,
        ok: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown webhook error.";
      const statusCode = message === "Request body too large." ? 413 : 400;
      sendJson(res, statusCode, { error: message, ok: false });
    }
  };

  const closeServer = async (): Promise<void> => {
    if (!server) {
      return;
    }

    const currentServer = server;
    server = undefined;
    isListening = false;

    if (!currentServer.listening) {
      return;
    }

    await new Promise<void>((resolve) => {
      currentServer.close(() => {
        resolve();
      });
    });
  };

  const startServer = async (
    ctx: UIContext,
    overridePort?: number,
  ): Promise<void> => {
    if (server) {
      if (ctx.hasUI) {
        ctx.ui.notify("pi-agentation is already running.", "warning");
      }
      return;
    }

    const listenPort = overridePort ?? config.port;
    activePort = listenPort;
    webhookUrl = formatWebhookUrl(config.host, activePort, config.path);

    const currentServer = createServer((req, res) => {
      void handleRequest(req, res);
    });
    server = currentServer;

    try {
      await new Promise<void>((resolve, reject) => {
        currentServer.once("listening", () => {
          resolve();
        });
        currentServer.once("error", reject);
        currentServer.listen(listenPort, config.host);
      });

      currentServer.on("error", (error) => {
        lastError = error instanceof Error ? error.message : String(error);
        isListening = false;
        updateStatus(ctx);
        if (ctx.hasUI) {
          ctx.ui.notify(`pi-agentation error: ${lastError}`, "error");
        }
      });

      const address = currentServer.address();
      if (address && typeof address !== "string") {
        const info = address as AddressInfo;
        webhookUrl = formatWebhookUrl(config.host, info.port, config.path);
      }

      isListening = true;
      lastError = undefined;
      updateStatus(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(`pi-agentation listening on ${webhookUrl}`, "info");
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      isListening = false;
      server = undefined;
      updateStatus(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(`pi-agentation failed to start: ${lastError}`, "error");
      }
    }
  };

  const stopServer = async (ctx: UIContext): Promise<void> => {
    if (!server) {
      if (ctx.hasUI) {
        ctx.ui.notify("pi-agentation is not running.", "warning");
      }
      return;
    }

    await closeServer();
    lastError = undefined;
    updateStatus(ctx);

    if (ctx.hasUI) {
      ctx.ui.notify("pi-agentation stopped.", "info");
    }
  };

  pi.on("agent_end", async () => {
    isAgentBusy = false;
  });

  pi.on("agent_start", async () => {
    isAgentBusy = true;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await closeServer();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.registerCommand("agentation-start", {
    description: "Start the pi-agentation webhook listener (optional port argument)",
    handler: async (args, ctx) => {
      const port = parseCommandPort(args);
      if (args && args.trim() !== "" && port === undefined) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Invalid port "${args.trim()}". Use a number between 1 and 65535.`,
            "warning",
          );
        }
        return;
      }

      await startServer(ctx, port);
    },
  });

  pi.registerCommand("agentation-stop", {
    description: "Stop the pi-agentation webhook listener",
    handler: async (_args, ctx) => {
      await stopServer(ctx);
    },
  });

  pi.registerCommand("agentation-status", {
    description: "Show pi-agentation webhook listener status",
    handler: async (_args, ctx) => {
      const details = [
        isListening
          ? `pi-agentation listening on ${webhookUrl}`
          : `pi-agentation not listening${lastError ? ` (${lastError})` : ""}`,
        `busy: ${isAgentBusy ? "yes" : "no"}`,
        `token: ${maskToken(config.token)}`,
        "queue mode while busy: followUp",
      ].join(" | ");

      if (ctx.hasUI) {
        ctx.ui.notify(details, isListening ? "info" : "warning");
      }
    },
  });
}
