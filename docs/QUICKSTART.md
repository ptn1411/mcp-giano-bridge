# Giano MCP Bridge — Quickstart

This MCP server lets an IDE agent (Antigravity/Kiro/others) **pull tasks from Giano** (via bot WebSocket) and **report progress/results back to Giano**.

## What you get

MCP tools exposed by this server:

- `giano_task_pull(timeoutMs?)` → get next task (or `null`)
- `giano_task_ack(taskId, message?)` → tell Giano you started
- `giano_task_progress(taskId, message)` → progress updates
- `giano_task_complete(taskId, status, summary)` → final report
- `giano_queue_stats()` → debug queue size
- `giano_send_message` / `giano_send_photo` / `giano_send_file` → send replies and files

## Prerequisites

- Giano backend running (default: `http://127.0.0.1:3000`)
- Bot created in Giano with a **bot token**
- Bot is subscribed to the chat where messages will be posted
- Node.js installed

## Build

```bash
cd mcp-giano-bridge
npm install
npm run build
```

## Required environment variables

```bash
export GIANO_BOT_TOKEN="..."                       # required
export GIANO_API_BASE_URL="http://127.0.0.1:3000"  # optional
export GIANO_WS_URL="ws://127.0.0.1:3000/bot/ws"    # optional
```

## User Guide

### Chatting with the bot

Just send messages naturally — the bridge queues everything for the agent:

```text
Fix the login bug in auth.ts
```

```text
Thêm dark mode cho trang settings
```

```text
Check why CI is failing and fix it
```

No special format needed. The agent reads your message and figures out what to do.

### Agent Commands (MCP Tools)

The agent uses these tools to interact with you:

- `giano_task_pull`: Check for new messages from you.
- `giano_task_ack`: Acknowledge it has seen your message.
- `giano_task_progress`: Send progress updates.
- `giano_task_complete`: Mark task as Done/Failed with a summary.
- `giano_send_message` / `giano_send_photo` / `giano_send_file`: Send replies and files.

### Automated Worker Mode

You can ask the agent to run in a loop:

`Use Prompt: giano-worker`

This instructs the agent to continuously poll for messages, process them, report results, and repeat.

### PM/BA Mode

You can configure Giano as a Project Manager that breaks down high-level requests into specific tasks. See `docs/GIANO_AS_PM.md` for details.

## Next steps

- Antigravity setup: see `docs/ANTIGRAVITY.md`
- Kiro setup (Power): see `docs/KIRO.md`
