# Giano MCP Bridge — Quickstart

This MCP server lets an IDE agent (Antigravity/Kiro/others) **pull tasks from Giano** (via bot WebSocket) and **report progress/results back to Giano**.

## What you get

MCP tools exposed by this server:

- `giano_task_pull(timeoutMs?)` → get next task (or `null`)
- `giano_task_ack(taskId, message?)` → tell Giano you started
- `giano_task_progress(taskId, message)` → progress updates
- `giano_task_complete(taskId, status, summary)` → final report
- `giano_queue_stats()` → debug queue size

## Prerequisites

- Giano backend running locally (default): `http://127.0.0.1:3000`
- Bot created in Giano with a **bot token**
- Bot is subscribed to the chat where tasks will be posted
- Node.js installed (to run the MCP server)

## Build

```bash
cd /root/clawd/giano/bot-sdk-typescript
npm install
npm run build

cd /root/clawd/giano/mcp-giano-bridge
npm install
npm run build
```

## Required environment variables

Set these in the environment of your IDE (or start the IDE from a shell where they are exported):

```bash
export GIANO_BOT_TOKEN="..."                       # required
export GIANO_API_BASE_URL="http://127.0.0.1:3000"  # optional
export GIANO_WS_URL="ws://127.0.0.1:3000/bot/ws"    # optional
```

## 4. User Guide: Collaborating with Bot

### Assigning Tasks

To create a task, simply chat with your bot in Giano. The bridge converts messages into tasks for the agent.

**A. Quick Task (Command)**
Use `/task` followed by your request.

```text
/task Refactor the login page to use new design system
```

**B. Structured Task (YAML)**
For complex requests, paste a structured block:

```text
taskId: auth-fix-01
goal: Fix refresh token rotation
files:
- src/auth.ts
- src/login.ts
DoD:
- Unit tests pass
- No regression in login flow
```

**C. Natural Language**
You can also just chat naturally. The agent sees all messages.
`@mybot please check why the build is failing`

### Agent Commands (MCP Tools)

The agent uses these tools to interact with you:

- `giano_task_pull`: Check for new messages from you.
- `giano_task_ack`: Acknowledge it has seen your task.
- `giano_task_progress`: Send progress updates (e.g. "50% - Running tests").
- `giano_task_complete`: Mark task as Done/Failed with a summary.
- `giano_send_message` / `giano_send_photo` / `giano_send_file`: Send replies and files.

### Automated Worker Mode

You can ask the agent to run in a loop:

`Use Prompt: giano-worker`

This prompt instructs the agent to:

1. Poll for tasks (`giano_task_pull`)
2. Execute them
3. Report results (`giano_task_complete`)
4. Repeat

## 5. Role Configuration: PM/BA & Developer

To set up a workflow where **Giano acts as the PM/BA** (defining tasks) and the **MCP Bridge acts as the Developer** (executing code), follow these steps:

### Step 1: Instruct Giano (The PM/BA)

Send this prompt to your Giano bot to set its persona:

> "You are an expert Project Manager and Business Analyst. Your goal is to break down my high-level requirements into clear, technical tasks for a Developer.
>
> When I give you a feature request, you must:
>
> 1. Analyze the requirements.
> 2. Break it down into small, actionable coding tasks.
> 3. For each task, output a structured block exactly like this:
>
> ```yaml
> taskId: <unique-id>
> goal: <clear title>
> description: <what needs to be done>
> acceptanceCriteria:
>   - <criteria 1>
>   - <criteria 2>
> files:
>   - <suggested file paths>
> ```
>
> Start by asking me what feature we are building today."

### Step 2: The Developer (MCP Bridge)

The configured MCP Bridge (running via Antigravity/Kiro) will automatically pick up these structured tasks from the chat and execute them as the "Developer".

You don't need to do anything special for the MCP side other than ensuring the **Automated Worker Mode** (above) is running or you manually trigger the tasks.

## Next steps

- Antigravity setup: see `docs/ANTIGRAVITY.md`
- Kiro setup (Power): see `docs/KIRO.md`
