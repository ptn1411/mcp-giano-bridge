import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Context } from "gianobot";
import { Bot } from "gianobot";
import { z } from "zod";

type TaskPayloadV2 = {
  version: "v2";
  taskId: string;
  goal: string;
};

type TaskItem = {
  taskId: string;
  updateId: string;
  messageId: string;
  chatId: string;
  fromUserId: string;
  rawText: string;
  receivedAt: string;
  // used for threaded replies
  replyToId: string;
  payload: TaskPayloadV2;
};

const botTokenEnv =
  process.env.GIANO_BOT_TOKEN ?? process.env.MESSAGES_BOT_TOKEN;
const apiBaseUrl =
  process.env.GIANO_API_BASE_URL ??
  process.env.MESSAGES_API_BASE_URL ??
  "http://localhost:3000";
const wsUrl =
  process.env.GIANO_WS_URL ??
  process.env.MESSAGES_WS_URL ??
  "ws://localhost:3000/bot/ws";

if (!botTokenEnv) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing bot token. Set GIANO_BOT_TOKEN (or MESSAGES_BOT_TOKEN).",
  );
  process.exit(2);
}

const BOT_TOKEN: string = botTokenEnv;

// In-memory task queue (simple). For production: persist to DB/redis.
const queue: TaskItem[] = [];
const inFlight = new Map<string, TaskItem>();

// Deduplication: track processed updateIds to avoid replaying messages
// (e.g. after WebSocket reconnect).
const processedIds = new Set<string>();
const MAX_PROCESSED_IDS = 500;

function buildPayload(rawText: string, fallbackId: string): TaskPayloadV2 {
  return {
    version: "v2",
    taskId: fallbackId,
    goal: rawText.trim() || "(empty)",
  };
}

function ctxToTask(ctx: any): TaskItem {
  const rawText = (ctx.text ?? "").trim();
  const updateId = String(ctx.updateId);
  const payload = buildPayload(rawText, updateId);

  return {
    taskId: payload.taskId,
    updateId,
    messageId: String(ctx.message?.messageId ?? ""),
    chatId: String(ctx.chatId),
    fromUserId: String(ctx.userId),
    rawText,
    receivedAt: new Date().toISOString(),
    replyToId: String(ctx.message?.messageId ?? ""),
    payload,
  };
}

// Custom logger that writes everything to stderr so it doesn't
// interfere with MCP's JSON-RPC communication over stdout.
const stderrLogger = {
  debug(message: string, ...args: any[]) {
    console.error(`[DEBUG] ${message}`, ...args);
  },
  info(message: string, ...args: any[]) {
    console.error(`[INFO] ${message}`, ...args);
  },
  error(message: string, ...args: any[]) {
    console.error(`[ERROR] ${message}`, ...args);
  },
};

async function startBot() {
  const bot = new Bot(BOT_TOKEN, {
    mode: "websocket",
    apiBaseUrl,
    wsUrl,
    logLevel: "none",
    logger: stderrLogger,
  });

  bot.on("text", async (ctx: Context) => {
    const task = ctxToTask(ctx as any);

    // Deduplicate: skip if we already processed this updateId
    if (processedIds.has(task.updateId)) return;
    processedIds.add(task.updateId);
    // Evict oldest entries when set grows too large
    if (processedIds.size > MAX_PROCESSED_IDS) {
      const first = processedIds.values().next().value;
      if (first) processedIds.delete(first);
    }

    // Push everything to the queue — let the agent decide how to handle it.
    queue.push(task);
  });

  bot.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Bot error:", err);
  });

  await bot.start();
  return bot;
}

const server = new McpServer({
  name: "mcp-giano-bridge",
  version: "0.2.0",
});

server.tool(
  "giano_task_pull",
  "Pull the next pending task sent to the Giano bot. Returns {task:null} if none.",
  {
    timeoutMs: z.number().int().positive().default(0),
  },
  async ({ timeoutMs }) => {
    const started = Date.now();

    const tryPop = () => {
      const item = queue.shift();
      if (!item) return null;
      inFlight.set(item.taskId, item);
      return item;
    };

    let item = tryPop();
    while (!item && timeoutMs > 0 && Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 250));
      item = tryPop();
    }

    const response = {
      version: "v2",
      task: item
        ? {
            taskId: item.taskId,
            chatId: item.chatId,
            messageId: item.messageId,
            replyToId: item.replyToId,
            fromUserId: item.fromUserId,
            receivedAt: item.receivedAt,
            payload: item.payload,
            rawText: item.rawText,
          }
        : null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

server.tool(
  "giano_task_ack",
  "Acknowledge that the IDE agent started working on the task.",
  {
    taskId: z.string(),
    message: z.string().default("🟦 Agent started."),
    parseMode: z.enum(["markdown", "html"]).optional(),
    silent: z
      .boolean()
      .default(false)
      .describe(
        "If true, skip sending a visible chat message (still tracks internally).",
      ),
  },
  async ({ taskId, message, parseMode, silent }) => {
    const task = inFlight.get(taskId);
    if (!task) throw new Error(`Unknown taskId: ${taskId}`);

    if (!silent) {
      await botGlobal.sendMessage(task.chatId, message, {
        replyToId: task.replyToId,
        parseMode,
      });
    }

    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_task_progress",
  "Send progress update back to Giano chat for a task.",
  {
    taskId: z.string(),
    message: z.string(),
    percent: z.number().int().min(0).max(100).optional(),
    phase: z.string().optional(),
    parseMode: z.enum(["markdown", "html"]).optional(),
  },
  async ({ taskId, message, percent, phase, parseMode }) => {
    const task = inFlight.get(taskId);
    if (!task) throw new Error(`Unknown taskId: ${taskId}`);

    const prefixParts: string[] = [];
    if (phase) prefixParts.push(`phase=${phase}`);
    if (percent !== undefined) prefixParts.push(`${percent}%`);

    const prefix = prefixParts.length
      ? `🟪 Progress (${prefixParts.join(", ")}): `
      : "🟪 Progress: ";

    await botGlobal.sendMessage(task.chatId, prefix + message, {
      replyToId: task.replyToId,
      parseMode,
    });

    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_task_complete",
  "Mark task complete and send final summary back to Giano.",
  {
    taskId: z.string(),
    status: z.enum(["success", "failed", "blocked"]).default("success"),
    summary: z.string(),
    filesTouched: z.array(z.string()).optional(),
    verify: z.array(z.string()).optional(),
    parseMode: z.enum(["markdown", "html"]).optional(),
    silent: z
      .boolean()
      .default(false)
      .describe(
        "If true, skip sending a visible chat message (still cleans up internal state).",
      ),
  },
  async ({
    taskId,
    status,
    summary,
    filesTouched,
    verify,
    parseMode,
    silent,
  }) => {
    const task = inFlight.get(taskId);
    if (!task) throw new Error(`Unknown taskId: ${taskId}`);

    inFlight.delete(taskId);

    if (!silent) {
      const lines: string[] = [summary.trim()];
      if (filesTouched?.length) {
        lines.push("", "Files:", ...filesTouched.map((f) => `- ${f}`));
      }
      if (verify?.length) {
        lines.push("", "Verify:", ...verify.map((c) => `- ${c}`));
      }

      const body = lines.join("\n").trim();

      const text =
        status === "success"
          ? `✅ Done (taskId=${taskId})\n${body}`
          : status === "blocked"
            ? `🟨 Blocked (taskId=${taskId})\n${body}`
            : `❌ Failed (taskId=${taskId})\n${body}`;

      await botGlobal.sendMessage(task.chatId, text, {
        replyToId: task.replyToId,
        parseMode,
      });
    }

    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_task_release",
  "Release an in-flight task back into the queue (e.g. if agent aborted).",
  {
    taskId: z.string(),
    reason: z.string().default("released"),
  },
  async ({ taskId, reason }) => {
    const task = inFlight.get(taskId);
    if (!task) throw new Error(`Unknown taskId: ${taskId}`);

    inFlight.delete(taskId);
    queue.unshift(task);

    await botGlobal.sendMessage(
      task.chatId,
      `🟧 Task released (taskId=${taskId}). Reason: ${reason}`,
      {
        replyToId: task.replyToId,
      },
    );

    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_queue_stats",
  "Get queue size and in-flight count.",
  {},
  async () => {
    const stats = {
      queued: queue.length,
      inFlight: inFlight.size,
      version: "0.2.0",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  },
);

server.tool(
  "giano_send_message",
  "Send a message to a Giano chat. Use this to converse with the user or ask for details.",
  {
    chatId: z.string(),
    message: z.string(),
    replyToId: z.string().optional(),
    parseMode: z.enum(["markdown", "html"]).optional(),
  },
  async ({ chatId, message, replyToId, parseMode }) => {
    // If replyToId is not provided, we might want to default to something if context allows, but here explicit is better.
    await botGlobal.sendMessage(chatId, message, { replyToId, parseMode });
    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_send_photo",
  "Send a photo to a Giano chat. Input 'photo' must be a local file path.",
  {
    chatId: z.string(),
    photo: z.string(),
    caption: z.string().optional(),
    replyToId: z.string().optional(),
    parseMode: z.enum(["markdown", "html"]).optional(),
  },
  async ({ chatId, photo, caption, replyToId, parseMode }) => {
    await botGlobal.sendPhoto(chatId, photo, { caption, replyToId, parseMode });
    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.tool(
  "giano_send_file",
  "Send a general file to a Giano chat. Input 'file' must be a local file path.",
  {
    chatId: z.string(),
    file: z.string(),
    filename: z.string().optional(),
    caption: z.string().optional(),
    replyToId: z.string().optional(),
    parseMode: z.enum(["markdown", "html"]).optional(),
  },
  async ({ chatId, file, filename, caption, replyToId, parseMode }) => {
    await botGlobal.sendFile(chatId, file, filename, {
      caption,
      replyToId,
      parseMode,
    });
    return { content: [{ type: "text", text: "OK" }] };
  },
);

server.resource("queue", "giano://queue", async (uri) => {
  const data = {
    queue: queue.map((t) => ({
      taskId: t.taskId,
      goal: t.payload.goal,
      fromUserId: t.fromUserId,
      receivedAt: t.receivedAt,
    })),
    inFlight: Array.from(inFlight.values()).map((t) => ({
      taskId: t.taskId,
      goal: t.payload.goal,
      startedAt: t.receivedAt,
    })),
  };
  return {
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

let botGlobal: Bot;

async function main() {
  botGlobal = await startBot();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
