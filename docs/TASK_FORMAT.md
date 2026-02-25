# Task format (v0.2)

The bridge accepts **any message** sent to the Giano bot chat. No special format required.

## How it works

Just chat naturally with the bot:

```text
Fix bug in the refresh token flow
```

```text
Refactor the login page to use the new design system
```

```text
Check why the build is failing and fix it
```

The bridge wraps every message into a v2 payload and queues it for the agent. The agent reads `rawText` (your original message) and `goal` (same content, trimmed) and decides what to do.

## Output schema

`giano_task_pull` returns:

```json
{
  "version": "v2",
  "task": {
    "taskId": "...",
    "chatId": "...",
    "messageId": "...",
    "replyToId": "...",
    "fromUserId": "...",
    "receivedAt": "...",
    "payload": {
      "version": "v2",
      "taskId": "...",
      "goal": "..."
    },
    "rawText": "..."
  }
}
```

- `taskId` = auto-generated from the message update ID
- `goal` = your message text (trimmed)
- `rawText` = your original message text
