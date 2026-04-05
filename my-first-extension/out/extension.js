"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const child_process_1 = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const initSqlJs = require("sql.js");
const TAG_START = "<!-- AG-MODEL-SWITCHER-START -->";
const TAG_END = "<!-- AG-MODEL-SWITCHER-END -->";
// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let _currentModelCommand = null;
let _requestedModelsList = false;
let _currentModelsData = null;
// Callbacks chờ /models trả về
let _modelsWaiters = [];
let server = null;
let statusBarItem;
// ─────────────────────────────────────────────
// PROTOBUF HELPERS
// ─────────────────────────────────────────────
function encodeVarint(value) {
    const bytes = [];
    let v = value >>> 0;
    while (v >= 0x80) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
    return Buffer.from(bytes);
}
function encodeLenDelimField(fieldNum, data) {
    const tag = encodeVarint((fieldNum << 3) | 2);
    const len = encodeVarint(data.length);
    return Buffer.concat([tag, len, data]);
}
function encodeStringField(fieldNum, value) {
    return encodeLenDelimField(fieldNum, Buffer.from(value, "utf8"));
}
function createOAuthInfo(accessToken, refreshToken, expiry) {
    const field1 = encodeStringField(1, accessToken);
    const field2 = encodeStringField(2, "Bearer");
    const field3 = encodeStringField(3, refreshToken);
    const timestampTag = encodeVarint((1 << 3) | 0);
    const timestampVal = encodeVarint(expiry);
    const timestampMsg = Buffer.concat([timestampTag, timestampVal]);
    const field4 = encodeLenDelimField(4, timestampMsg);
    return Buffer.concat([field1, field2, field3, field4]);
}
// ─────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────
async function withDatabase(dbPath, fn) {
    const SQL = await initSqlJs({
        locateFile: (file) => path.join(__dirname, file),
    });
    let db;
    if (fs.existsSync(dbPath)) {
        db = new SQL.Database(fs.readFileSync(dbPath));
    }
    else {
        db = new SQL.Database();
    }
    try {
        fn(db);
        fs.writeFileSync(dbPath, Buffer.from(db.export()));
    }
    finally {
        db.close();
    }
}
async function injectTokenNewFormat(dbPath, accessToken, refreshToken, expiry) {
    await withDatabase(dbPath, (db) => {
        db.run("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");
        const oauthInfo = createOAuthInfo(accessToken, refreshToken, expiry);
        const oauthInfoB64 = oauthInfo.toString("base64");
        const inner2 = encodeStringField(1, oauthInfoB64);
        const inner1 = encodeStringField(1, "oauthTokenInfoSentinelKey");
        const inner = Buffer.concat([inner1, encodeLenDelimField(2, inner2)]);
        const outer = encodeLenDelimField(1, inner);
        db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", [
            "antigravityUnifiedStateSync.oauthToken",
            outer.toString("base64"),
        ]);
        db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", [
            "antigravityOnboarding",
            "true",
        ]);
    });
}
// ─────────────────────────────────────────────
// FILE SYSTEM HELPERS
// ─────────────────────────────────────────────
function writeFileElevated(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, "utf8");
    }
    catch (err) {
        if (err.code !== "EACCES" && err.code !== "EPERM")
            throw err;
        const tmpPath = path.join(os.tmpdir(), "ag-model-" + Date.now() + ".tmp");
        fs.writeFileSync(tmpPath, content, "utf8");
        try {
            if (process.platform === "linux") {
                (0, child_process_1.execSync)(`pkexec bash -c "cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'"`, { timeout: 30000 });
            }
            else if (process.platform === "darwin") {
                const cmd = `cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'`;
                (0, child_process_1.execSync)(`osascript -e 'do shell script "${cmd}" with administrator privileges'`, { timeout: 30000 });
            }
            else {
                throw err;
            }
        }
        catch (elevErr) {
            try {
                fs.unlinkSync(tmpPath);
            }
            catch (_) { }
            throw new Error(`Permission denied writing to ${filePath}. Run VS Code as Administrator.`);
        }
        try {
            fs.unlinkSync(tmpPath);
        }
        catch (_) { }
    }
}
function findFileRecursive(dir, filename, maxDepth) {
    if (maxDepth <= 0)
        return null;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename)
                return fullPath;
            if (entry.isDirectory()) {
                const result = findFileRecursive(fullPath, filename, maxDepth - 1);
                if (result)
                    return result;
            }
        }
    }
    catch (_) { }
    return null;
}
function getWorkbenchPath() {
    const appRoot = vscode.env.appRoot;
    const candidates = [
        path.join(appRoot, "out", "vs", "code", "electron-browser", "workbench", "workbench.html"),
        path.join(appRoot, "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html"),
        path.join(appRoot, "out", "vs", "workbench", "workbench.html"),
        path.join(appRoot, "out", "vs", "code", "browser", "workbench", "workbench.html"),
        path.join(appRoot, "out", "vs", "code", "electron-main", "workbench", "workbench.html"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    return findFileRecursive(path.join(appRoot, "out"), "workbench.html", 6);
}
function isScriptInjected(wbPath) {
    try {
        return fs.readFileSync(wbPath, "utf8").includes(TAG_START);
    }
    catch {
        return false;
    }
}
function installScript(context) {
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
        console.error("[AG] workbench.html not found!");
        return false;
    }
    // Tạm thời comment dòng này lại để ép extension chèn lại code mới
    // if (isScriptInjected(wbPath)) return true;
    const scriptPathTemplate = path.join(context.extensionPath, "media", "autoScript.js");
    if (!fs.existsSync(scriptPathTemplate)) {
        console.error("[AG] Missing autoScript.js in media folder!");
        return false;
    }
    try {
        const scriptContent = fs.readFileSync(scriptPathTemplate, "utf8");
        const wbDir = path.dirname(wbPath);
        let html = fs.readFileSync(wbPath, "utf8");
        // Remove old injection if any
        html = html.replace(new RegExp(`${TAG_START}[\\s\\S]*?${TAG_END}`, "g"), "");
        const ts = Date.now();
        const destPath = path.join(wbDir, "ag-model-script.js");
        writeFileElevated(destPath, scriptContent);
        const injection = `${TAG_START}<script src="ag-model-script.js?v=${ts}"></script>${TAG_END}`;
        html = html.replace("</html>", injection + "</html>");
        writeFileElevated(wbPath, html);
        console.log("[AG] ✅ Script injected into workbench.html");
        return true;
    }
    catch (err) {
        console.error("[AG] Inject error:", err.message);
        vscode.window.showErrorMessage(`[AG] Need Administrator rights to inject script!`);
        return false;
    }
}
// ─────────────────────────────────────────────
// DEVICE PROFILE
// ─────────────────────────────────────────────
function writeDeviceProfile(storagePath, profile) {
    if (!fs.existsSync(storagePath))
        return;
    const json = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    if (!json.telemetry || typeof json.telemetry !== "object")
        json.telemetry = {};
    Object.assign(json.telemetry, profile);
    json["telemetry.machineId"] = profile.machineId;
    json["telemetry.macMachineId"] = profile.macMachineId;
    json["telemetry.devDeviceId"] = profile.devDeviceId;
    json["telemetry.sqmId"] = profile.sqmId;
    json["storage.serviceMachineId"] = profile.devDeviceId;
    fs.writeFileSync(storagePath, JSON.stringify(json, null, 2));
    syncServiceMachineId(path.join(path.dirname(storagePath), "state.vscdb"), profile.devDeviceId);
}
async function syncServiceMachineId(dbPath, serviceId) {
    if (!fs.existsSync(dbPath))
        return;
    try {
        await withDatabase(dbPath, (db) => {
            db.run("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");
            db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", [
                "storage.serviceMachineId",
                serviceId,
            ]);
        });
    }
    catch { }
}
function getGlobalStoragePath(context) {
    return path.dirname(context.globalStorageUri.fsPath);
}
async function performSwitch(context, payload) {
    try {
        const globalStorage = getGlobalStoragePath(context);
        if (payload.deviceProfile) {
            writeDeviceProfile(path.join(globalStorage, "storage.json"), payload.deviceProfile);
        }
        await injectTokenNewFormat(path.join(globalStorage, "state.vscdb"), payload.accessToken, payload.refreshToken, payload.expiryTimestamp);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
// ─────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}
function startServer(context) {
    const config = vscode.workspace.getConfiguration("ag-switch");
    const port = config.get("port", 23816);
    server = http.createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        const json = (status, data) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
        };
        const url = (req.url || "").split("?")[0];
        // ── Health ──
        if (req.method === "GET" && url === "/health") {
            return json(200, { ok: true, version: "0.1.0" });
        }
        // ── Switch account ──
        if (req.method === "POST" && url === "/switch") {
            try {
                const payload = JSON.parse(await readBody(req));
                if (!payload.accessToken || !payload.refreshToken || !payload.email) {
                    return json(400, { error: "Missing required fields" });
                }
                const result = await performSwitch(context, payload);
                if (result.ok) {
                    json(200, { ok: true, message: `Switched to ${payload.email}` });
                    vscode.window.showInformationMessage(`AG Switch: Switching to ${payload.email}...`);
                    setTimeout(() => vscode.commands.executeCommand("workbench.action.reloadWindow"), 800);
                }
                else {
                    json(500, { error: result.error });
                }
            }
            catch (e) {
                json(500, { error: e.message || String(e) });
            }
            return;
        }
        // ── Change model ──
        if (req.method === "POST" && url === "/model") {
            try {
                const payload = JSON.parse(await readBody(req));
                if (!payload.model)
                    return json(400, { error: "Missing field: model" });
                _currentModelCommand = payload.model;
                json(200, { ok: true, message: `Switching to: ${payload.model}` });
                // Auto-clear sau 10s để tránh duplicate
                setTimeout(() => {
                    if (_currentModelCommand === payload.model)
                        _currentModelCommand = null;
                }, 10000);
            }
            catch (e) {
                json(500, { error: e.message || String(e) });
            }
            return;
        }
        // ── Get models list (blocking wait) ──
        if (req.method === "GET" && url === "/models") {
            // Nếu client đã auto-report models lúc load, trả về ngay
            if (_currentModelsData && _currentModelsData.length > 0) {
                return json(200, { ok: true, models: _currentModelsData });
            }
            // Chưa có → yêu cầu client gửi lên, chờ callback
            _requestedModelsList = true;
            const TIMEOUT_MS = 5000;
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    _modelsWaiters = _modelsWaiters.filter((w) => w !== waiter);
                    json(504, { error: "Timeout waiting for models from UI" });
                }
            }, TIMEOUT_MS);
            const waiter = (models) => {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timer);
                json(200, { ok: true, models });
            };
            _modelsWaiters.push(waiter);
            return;
        }
        // ── Models report (từ client script) ──
        if (req.method === "POST" && url === "/models-report") {
            try {
                const payload = JSON.parse(await readBody(req));
                const models = payload.models || [];
                _currentModelsData = models;
                // Resolve tất cả waiters đang chờ
                const waiters = _modelsWaiters.splice(0);
                waiters.forEach((w) => w(models));
                json(200, { ok: true });
            }
            catch (e) {
                json(500, { error: e.message });
            }
            return;
        }
        // ── Poll command (từ client script, mỗi 300ms) ──
        if (req.method === "GET" && url === "/ag-model-command") {
            if (_currentModelCommand) {
                const model = _currentModelCommand;
                _currentModelCommand = null;
                return json(200, { command: "change_model", model });
            }
            if (_requestedModelsList) {
                _requestedModelsList = false;
                return json(200, { command: "get_models" });
            }
            return json(200, { command: "none" });
        }
        json(404, { error: "Not found" });
    });
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            vscode.window.showWarningMessage(`AG Switch: Port ${port} is in use.`);
        }
        else {
            vscode.window.showErrorMessage(`AG Switch: Server error: ${err.message}`);
        }
    });
    server.listen(port, "127.0.0.1", () => {
        statusBarItem.text = "$(plug) AG Switch";
        statusBarItem.tooltip = `AG Switch listening on port ${port}`;
        statusBarItem.show();
        console.log(`[AG] Server ready on port ${port}`);
    });
}
// ─────────────────────────────────────────────
// EXTENSION LIFECYCLE
// ─────────────────────────────────────────────
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    statusBarItem.command = "ag-switch.showStatus";
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand("ag-switch.showStatus", () => {
        const port = vscode.workspace
            .getConfiguration("ag-switch")
            .get("port", 23816);
        vscode.window.showInformationMessage(`AG Switch: Listening on port ${port}\nStorage: ${getGlobalStoragePath(context)}`);
    }));
    startServer(context);
    if (!installScript(context)) {
        console.error("[AG] Failed to inject script on startup.");
    }
}
function deactivate() {
    if (server) {
        server.close();
        server = null;
    }
}
//# sourceMappingURL=extension.js.map