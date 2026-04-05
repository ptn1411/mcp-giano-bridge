(function () {
  if (window._agModelChangerLoaded) return;
  window._agModelChangerLoaded = true;

  if (window._agModelChangerInterval)
    clearInterval(window._agModelChangerInterval);

  var AG_HTTP_PORT = 23816;
  var POLL_INTERVAL_MS = 300;
  var MAX_ERRORS = 10;
  var _pollErrors = 0;

  // ─────────────────────────────────────────────
  // DOM HELPERS
  // ─────────────────────────────────────────────

  function getPanel() {
    return (
      document.getElementById("antigravity.agentSidePanelInputBox") ||
      document.body
    );
  }

  function getModelDialog() {
    var dialogs = getPanel().querySelectorAll('div[role="dialog"]');
    for (var i = 0; i < dialogs.length; i++) {
      var header = dialogs[i].querySelector(".opacity-80");
      if (header && header.textContent.trim() === "Model") return dialogs[i];
    }
    return null;
  }

  // Thay hàm getModelsFromDOM trong ag-model-changer.js

  function getModelsFromDOM() {
    var dialog = getModelDialog();
    if (!dialog) return [];

    var KNOWN_KEYWORDS = [
      "gemini",
      "claude",
      "gpt",
      "sonnet",
      "opus",
      "flash",
      "pro",
      "120b",
    ];
    var models = [];

    dialog.querySelectorAll("span.font-medium > span").forEach(function (sp) {
      var text = sp.textContent.trim();
      if (!text) return;
      if (text.length > 60) return; // tên model không dài hơn 60 ký tự

      // Chỉ lấy nếu chứa ít nhất 1 keyword model
      var lower = text.toLowerCase();
      var isModel = KNOWN_KEYWORDS.some(function (kw) {
        return lower.includes(kw);
      });
      if (isModel && !models.includes(text)) {
        models.push(text);
      }
    });

    return models;
  }

  function clickModelSelector() {
    var MODEL_KEYWORDS = [
      "gemini",
      "claude",
      "gpt",
      "sonnet",
      "opus",
      "flash",
      "pro",
      "120b",
    ];
    var candidates = getPanel().querySelectorAll('[tabindex="0"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el.closest('div[role="button"][aria-haspopup="dialog"]')) continue;
      var text = (el.innerText || "").toLowerCase();
      for (var j = 0; j < MODEL_KEYWORDS.length; j++) {
        if (text.includes(MODEL_KEYWORDS[j])) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  function clickModelItem(modelName) {
    var dialog = getModelDialog();
    if (!dialog) return false;
    var items = dialog.querySelectorAll(".cursor-pointer");
    for (var i = 0; i < items.length; i++) {
      var nameSpan =
        items[i].querySelector("span.font-medium > span") ||
        items[i].querySelector("span.font-medium");
      if (!nameSpan) continue;
      var text = nameSpan.textContent.trim();
      if (
        text.toLowerCase() === modelName.toLowerCase() ||
        text.toLowerCase().includes(modelName.toLowerCase())
      ) {
        items[i].click();
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────
  // HTTP HELPERS
  // ─────────────────────────────────────────────

  function httpGet(path, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open(
      "GET",
      "http://127.0.0.1:" + AG_HTTP_PORT + path + "?t=" + Date.now(),
      true,
    );
    xhr.timeout = 800;
    xhr.onload = function () {
      if (xhr.status === 200) onSuccess(xhr.responseText);
      else if (onError) onError();
    };
    xhr.onerror = onError || null;
    xhr.ontimeout = onError || null;
    xhr.send();
  }

  function httpPost(path, data, onSuccess) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "http://127.0.0.1:" + AG_HTTP_PORT + path, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      if (onSuccess)
        xhr.onload = function () {
          if (xhr.status === 200) onSuccess();
        };
      xhr.send(JSON.stringify(data));
    } catch (e) {
      console.error("[AG] POST failed", e);
    }
  }

  // ─────────────────────────────────────────────
  // COMMAND HANDLERS
  // ─────────────────────────────────────────────

  function handleGetModels() {
    var models = getModelsFromDOM();

    if (models.length > 0) {
      console.log("[AG] Models (DOM):", models);
      httpPost("/models-report", { models: models });
      return;
    }

    // Fallback: mở dropdown rồi đọc
    if (clickModelSelector()) {
      setTimeout(function () {
        var models = getModelsFromDOM();
        console.log("[AG] Models (after click):", models);
        httpPost("/models-report", { models: models });
        setTimeout(clickModelSelector, 100); // đóng dropdown
      }, 400);
    } else {
      httpPost("/models-report", { models: [] });
    }
  }

  function handleChangeModel(modelName) {
    console.log("[AG] Switching →", modelName);

    // Thử click trực tiếp vào item mà không cần mở dropdown
    // vì dialog luôn tồn tại trong DOM
    if (clickModelItem(modelName)) {
      console.log("[AG] Model switched (direct):", modelName);
      return;
    }

    // Fallback: mở dropdown rồi click
    if (clickModelSelector()) {
      setTimeout(function () {
        if (clickModelItem(modelName)) {
          console.log("[AG] Model switched (after open):", modelName);
        } else {
          console.warn("[AG] Model not found:", modelName);
          clickModelSelector(); // đóng dropdown
        }
      }, 400);
    }
  }

  // ─────────────────────────────────────────────
  // AUTO REPORT ON LOAD
  // Tự động gửi models lên server khi script load
  // ─────────────────────────────────────────────

  // Thay vì 1500ms, chờ 3000ms và retry nếu rỗng
  var _autoReportAttempts = 0;

  function autoReportModels() {
    _autoReportAttempts++;
    var models = getModelsFromDOM();

    if (models.length > 0) {
      console.log("[AG] Auto-report models:", models);
      httpPost("/models-report", { models: models });
      return;
    }

    // Retry tối đa 5 lần mỗi 2 giây
    if (_autoReportAttempts < 5) {
      setTimeout(autoReportModels, 2000);
    } else {
      console.warn("[AG] Could not auto-report models after 5 attempts");
    }
  }

  setTimeout(autoReportModels, 2000); // bắt đầu sau 2 giây

  // ─────────────────────────────────────────────
  // POLL LOOP
  // ─────────────────────────────────────────────

  window._agModelChangerInterval = setInterval(function () {
    if (_pollErrors > MAX_ERRORS) return;

    httpGet(
      "/ag-model-command",
      function (responseText) {
        _pollErrors = 0;
        try {
          var resp = JSON.parse(responseText);
          if (!resp || !resp.command || resp.command === "none") return;

          if (resp.command === "change_model" && resp.model) {
            handleChangeModel(resp.model);
          } else if (resp.command === "get_models") {
            handleGetModels();
          }
        } catch (e) {
          console.error("[AG] Parse error", e);
        }
      },
      function () {
        _pollErrors++;
      },
    );
  }, POLL_INTERVAL_MS);

  console.log("[AG Model Changer] Ready — port", AG_HTTP_PORT);
})();
