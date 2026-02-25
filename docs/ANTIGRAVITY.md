# Using Giano MCP Bridge in Google Antigravity IDE

Antigravity supports MCP and can run a local MCP server via a command.

## 1) Build the MCP server

```bash
cd mcp-giano-bridge
npm install
npm run build
```

## 2) Ensure the bot websocket endpoint exists

Your Giano backend must expose bot websocket at:

- `GET /bot/ws?token=...`

Quick check (should be 400 without token):

```bash
curl -i http://127.0.0.1:3000/bot/ws
```

If you still get 404, your backend is not running the updated code.

## 3) Set environment variables

Antigravity launches MCP servers with env from its MCP config.

You need:

- `GIANO_BOT_TOKEN` (required)
- `GIANO_API_BASE_URL` (optional, default `http://127.0.0.1:3000`)
- `GIANO_WS_URL` (optional, default `ws://127.0.0.1:3000/bot/ws`)

## 4) Add MCP server in Antigravity

Có **2 cách** để thêm:

### Cách 1: Sửa trực tiếp `settings.json` (khuyên dùng)

Mở file cấu hình Antigravity:

```
~/.gemini/settings.json
```

> Trên Windows: `C:\Users\<USERNAME>\.gemini\settings.json`

Thêm entry `"giano"` vào trong key `"mcpServers"`:

```json
{
  "mcpServers": {
    "giano": {
      "command": "node",
      "args": ["C:\\Users\\NAM\\Code\\web\\mcp-giano-bridge\\dist\\index.js"],
      "env": {
        "GIANO_BOT_TOKEN": "YOUR_BOT_TOKEN",
        "GIANO_API_BASE_URL": "https://messages-api.bug.edu.vn",
        "GIANO_WS_URL": "wss://messages-api.bug.edu.vn/bot/ws"
      }
    }
  }
}
```

> **Lưu ý:** Thay `YOUR_BOT_TOKEN` bằng token thật của bot.
> Path trong `args` phải trỏ đúng tới `dist/index.js` đã build.

### Cách 2: Dùng UI trong Antigravity

1. Mở **MCP Store** (icon ổ cắm ⚡ ở sidebar)
2. Click **Manage MCP Servers**
3. Click **View raw config** (mở `settings.json`)
4. Thêm entry `"giano"` như Cách 1 ở trên

### Sau khi thêm

**Restart Antigravity** (Ctrl+Shift+P → `Reload Window`) để nó nhận MCP server mới.

Kiểm tra server đã chạy bằng cách gõ trong chat:

```
Dùng tool giano_queue_stats
```

Nếu trả về `{"queued": 0, "inFlight": 0, "version": "0.2.0"}` → thành công ✅

## 5) Recommended agent workflow

1. **Auto-Worker Mode**: Use the `giano-worker` prompt to let the agent autonomously poll and execute tasks.
2. **Manual Conversation**:
   - The bridge queues **all messages** from the bot.
   - Use `giano_send_message` to talk back to the user.
   - Use `giano_task_complete` to finish a task.

## Troubleshooting

### Bot doesn't receive messages

- Verify `GIANO_BOT_TOKEN` is correct
- Verify bot is active and subscribed to the chat
- Check `GIANO_WS_URL` points to `/bot/ws` (not `/ws`)

### `/bot/ws` returns 404

Backend is running an older build. Rebuild/restart backend.

### Messages not appearing in queue

- Use `giano_queue_stats` to check if queue is empty.
- Ensure the agent is polling with `giano_task_pull`.

# Trong mỗi project, tạo symlink tới file gốc

```
New-Item -ItemType SymbolicLink `
  -Path ".agents\workflows\giano-worker.md" `
  -Target "C:\Users\NAM\Code\web\mcp-giano-bridge\.agents\workflows\giano-worker.md"
```

# Tạo symlink cho MCP server
```
New-Item -ItemType SymbolicLink `  -Path ".agents\mcp\giano.json"`
-Target "C:\Users\NAM\Code\web\mcp-giano-bridge\.agents\mcp\giano.json"
```
