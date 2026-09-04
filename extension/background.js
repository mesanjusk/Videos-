const DEFAULTS = {
  apiBaseUrl: "http://localhost:3000",
  extensionToken: "",
  workerId: `chrome-${crypto.randomUUID()}`,
  enabled: false,
  aiFallbackEnabled: false,
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
};

const UPLOAD_CHUNK_BYTES = 256 * 1024;
let running = false;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  await chrome.storage.local.set({ ...DEFAULTS, ...current });
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  chrome.alarms.create("videos-flow-poll", { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("videos-flow-poll", { periodInMinutes: 0.5 });
  void pollOnce();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "videos-flow-poll") void pollOnce();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FLOW_RUNNER_POLL_NOW") {
    pollOnce().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

async function config() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...saved };
}

async function api(path, options = {}) {
  const cfg = await config();
  if (!cfg.extensionToken) throw new Error("Extension token is not configured");
  const response = await fetch(`${cfg.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-browser-extension-token": cfg.extensionToken,
      "x-browser-extension-worker": cfg.workerId,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function pollOnce() {
  if (running) return;
  const cfg = await config();
  if (!cfg.enabled || !cfg.extensionToken) return;
  running = true;
  try {
    const claimed = await api("/api/browser-automation/extension/tasks/claim", {
      method: "POST",
      body: JSON.stringify({ providerId: "google-flow" }),
    });
    if (claimed.task) await executeTask(claimed.task);
  } catch (error) {
    console.error("[Videos Flow Runner] poll failed", error);
  } finally {
    running = false;
  }
}

async function report(taskId, stage, extra = {}) {
  return api(`/api/browser-automation/extension/tasks/${taskId}/status`, {
    method: "POST",
    body: JSON.stringify({ stage, ...extra }),
  });
}

async function executeTask(run) {
  const taskId = String(run._id || run.taskDefinition?.id);
  const task = run.taskDefinition;
  let tabId;
  const downloads = [];
  const recoveryLog = [];
  try {
    for (let index = 0; index < task.steps.length; index += 1) {
      const step = task.steps[index];
      if (step.stage) await report(taskId, step.stage, { currentStepIndex: index });

      if (step.action === "navigate") {
        tabId = await navigate(tabId, String(step.params.url));
        continue;
      }
      if (!tabId) throw new Error("Task attempted a page action before navigate");

      if (step.action === "upload_file" || step.action === "upload_url") {
        await uploadAssets(tabId, step, task.metadata || {});
        continue;
      }

      if (step.action === "download_file") {
        const download = await executeDownload(tabId, step, step.timeoutMs || 120000);
        downloads.push(download);
        continue;
      }

      const payload = {
        action: step.action,
        selector: step.params.selector,
        text: step.params.text ?? resolveTextFrom(step.params.textFrom, task.metadata || {}),
        ms: step.params.ms,
        optional: step.params.optional === true,
      };
      let result = await sendPageAction(tabId, payload, step.timeoutMs);

      if (!result.success && step.params.optional !== true) {
        const recovered = await tryGeminiRecovery(tabId, step, payload, result.error || "Structured action failed");
        if (recovered) {
          result = recovered.result;
          recoveryLog.push({
            stepId: step.id,
            originalError: recovered.originalError,
            recoveredSelector: recovered.selector,
            model: recovered.model,
          });
        }
      }

      if (!result.success && step.params.optional !== true) {
        throw new Error(result.error || `Action ${step.action} failed at ${step.id}`);
      }
    }

    await report(taskId, "completed", {
      currentStepIndex: task.steps.length,
      downloads,
      resultMetadata: {
        completedBy: "chrome-extension",
        completedAt: new Date().toISOString(),
        aiRecoveryCount: recoveryLog.length,
        aiRecoveries: recoveryLog,
      },
    });
  } catch (error) {
    console.error("[Videos Flow Runner] task failed", error);
    await report(taskId, "failed", {
      error: error instanceof Error ? error.message : String(error),
      downloads,
      resultMetadata: {
        failedBy: "chrome-extension",
        failedAt: new Date().toISOString(),
        aiRecoveryCount: recoveryLog.length,
        aiRecoveries: recoveryLog,
      },
    }).catch(() => {});
  }
}

async function navigate(tabId, url) {
  if (tabId) await chrome.tabs.update(tabId, { url, active: true });
  else tabId = (await chrome.tabs.create({ url, active: true })).id;
  if (!tabId) throw new Error("Chrome did not return a tab id");
  await waitForTabComplete(tabId, 45000);
  return tabId;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out waiting for Google Flow to load")), timeoutMs);
    const listener = (changedTabId, info) => {
      if (changedTabId === tabId && info.status === "complete") finish();
    };
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") finish(); }).catch(() => {});
  });
}

async function sendPageAction(tabId, payload, timeoutMs = 30000) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ success: false, error: "Page action timed out" }), timeoutMs));
  const action = chrome.tabs.sendMessage(tabId, { type: "VIDEOS_FLOW_ACTION", payload }).catch(async () => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/executor.js"] });
    return chrome.tabs.sendMessage(tabId, { type: "VIDEOS_FLOW_ACTION", payload });
  });
  return Promise.race([action, timeout]);
}

function isRecoverableAction(action) {
  return ["click", "paste", "input_text", "wait_for"].includes(action);
}

async function tryGeminiRecovery(tabId, step, payload, originalError) {
  const cfg = await config();
  if (!cfg.aiFallbackEnabled || !cfg.geminiApiKey || !isRecoverableAction(step.action)) return null;

  try {
    const snapshot = await buildRecoverySnapshot(tabId);
    if (!snapshot?.elements?.length) return null;

    const prompt = [
      "You are a last-resort selector recovery assistant for an already planned Google Flow browser task.",
      "Do not change the mission or invent extra actions. Choose the single visible element that best matches the failed planned action.",
      `Planned action: ${step.action}`,
      `Failed selector: ${String(step.params.selector || "(none)")}`,
      `Failure: ${originalError}`,
      payload.text ? `Planned text (do not rewrite it): ${payload.text}` : "",
      `Page URL: ${snapshot.url}`,
      `Page title: ${snapshot.title}`,
      "Visible interactive elements:",
      snapshot.elements.map((el) => `[${el.ref}] ${el.tag} role=${el.role || ""} text=${JSON.stringify(el.text || "")} aria=${JSON.stringify(el.aria || "")} placeholder=${JSON.stringify(el.placeholder || "")}`).join("\n"),
      "Return ONLY JSON: {\"ref\":\"e1\",\"reason\":\"short reason\"}. The ref must exist above.",
    ].filter(Boolean).join("\n");

    const decision = await callGeminiRecovery(prompt, cfg);
    const ref = typeof decision?.ref === "string" ? decision.ref : "";
    if (!/^e\d+$/.test(ref) || !snapshot.elements.some((el) => el.ref === ref)) return null;

    const selector = `[data-videos-ai-ref="${ref}"]`;
    const result = await sendPageAction(tabId, { ...payload, selector }, Math.min(step.timeoutMs || 30000, 30000));
    if (!result.success) return null;

    return { result, selector, model: decision.__model || cfg.geminiModel || "gemini-2.5-flash", originalError };
  } catch (error) {
    console.warn("[Videos Flow Runner] Gemini recovery failed", error);
    return null;
  }
}

async function buildRecoverySnapshot(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.querySelectorAll("[data-videos-ai-ref]").forEach((el) => el.removeAttribute("data-videos-ai-ref"));
      const candidates = Array.from(document.querySelectorAll([
        "button",
        "input",
        "textarea",
        "select",
        "a[href]",
        "[role='button']",
        "[role='textbox']",
        "[contenteditable='true']",
      ].join(","))).filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }).slice(0, 120);

      const elements = candidates.map((el, index) => {
        const ref = `e${index + 1}`;
        el.setAttribute("data-videos-ai-ref", ref);
        return {
          ref,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || "",
          text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180),
          aria: el.getAttribute("aria-label") || "",
          placeholder: el.getAttribute("placeholder") || "",
        };
      });

      return { url: location.href, title: document.title, elements };
    },
  });
  return results?.[0]?.result;
}

async function callGeminiRecovery(systemPrompt, cfg) {
  const primaryModel = cfg.geminiModel || "gemini-2.5-flash";
  const candidateModels = [
    primaryModel,
    "gemini-2.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
  ];
  const modelsToTry = candidateModels.filter((model, index, self) => Boolean(model) && !model.includes("pro") && self.indexOf(model) === index);
  let lastError = null;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const generationConfig = { temperature: 0.1 };
        if (attempt === 1) generationConfig.responseMimeType = "application/json";

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
            ],
            generationConfig,
          }),
        });

        if (response.status === 429 || response.status === 503) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `Server busy (HTTP ${response.status})`;
          lastError = new Error(errMsg);
          if (errMsg.includes("limit: 0") || errMsg.includes("Quota exceeded for metric")) break;
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
          continue;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message = errorData?.error?.message || `Gemini API error: HTTP ${response.status}`;
          lastError = new Error(message);
          if (message.includes("API key")) throw lastError;
          break;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        let rawText = "";
        for (const part of parts) if (part.text && !part.thought) rawText += part.text;
        if (!rawText.trim()) for (const part of parts) if (part.text) rawText += part.text;

        if (!rawText.trim()) {
          const finishReason = candidate?.finishReason || data?.promptFeedback?.blockReason || "EMPTY";
          lastError = new Error(`Empty response from Gemini API (finishReason: ${finishReason})`);
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          break;
        }

        let cleanText = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        let parsed;
        try {
          parsed = JSON.parse(cleanText);
        } catch {
          const firstBrace = cleanText.indexOf("{");
          const lastBrace = cleanText.lastIndexOf("}");
          if (firstBrace === -1 || lastBrace <= firstBrace) throw new Error(`Could not parse Gemini recovery JSON: ${cleanText.slice(0, 100)}`);
          parsed = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
        }
        parsed.__model = model;
        return parsed;
      } catch (error) {
        lastError = error;
        if (String(error?.message || error).includes("API key")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        break;
      }
    }
  }

  throw lastError || new Error("No Gemini fallback model returned a usable response");
}

function resolveTextFrom(source, metadata) {
  if (!source) return undefined;
  return metadata[source];
}

function resolveUploadSpecs(step, metadata) {
  if (Array.isArray(step.params.files)) return step.params.files;
  if (typeof step.params.url === "string") {
    return [{ url: step.params.url, fileName: step.params.fileName, mimeType: step.params.mimeType }];
  }
  if (step.params.filesFrom === "referenceImages") {
    return (metadata.referenceImageUrls || []).map((url) => ({ url }));
  }
  return [];
}

async function uploadAssets(tabId, step, metadata) {
  const specs = resolveUploadSpecs(step, metadata);
  if (!specs.length) throw new Error(`No upload files resolved for ${step.id}`);

  const uploadId = crypto.randomUUID();
  const files = [];
  const buffers = [];
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const response = await fetch(spec.url);
    if (!response.ok) throw new Error(`Could not fetch reference asset (${response.status}): ${spec.url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileId = `${uploadId}-${index}`;
    files.push({
      fileId,
      name: spec.fileName || fileNameFromUrl(spec.url, index),
      mimeType: spec.mimeType || response.headers.get("content-type") || "application/octet-stream",
      size: bytes.byteLength,
    });
    buffers.push({ fileId, bytes });
  }

  let result = await sendPageAction(tabId, {
    action: "upload_begin",
    uploadId,
    selector: step.params.selector,
    files,
    optional: step.params.optional === true,
  }, step.timeoutMs || 30000);
  if (!result.success) throw new Error(result.error || `Upload initialization failed at ${step.id}`);

  for (const file of buffers) {
    let chunkIndex = 0;
    for (let offset = 0; offset < file.bytes.length; offset += UPLOAD_CHUNK_BYTES) {
      const chunk = file.bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
      result = await sendPageAction(tabId, {
        action: "upload_chunk",
        uploadId,
        fileId: file.fileId,
        chunkIndex,
        base64: bytesToBase64(chunk),
      }, step.timeoutMs || 30000);
      if (!result.success) throw new Error(result.error || `Upload chunk failed at ${step.id}`);
      chunkIndex += 1;
    }
  }

  result = await sendPageAction(tabId, { action: "upload_commit", uploadId }, step.timeoutMs || 30000);
  if (!result.success) throw new Error(result.error || `Upload commit failed at ${step.id}`);
}

function fileNameFromUrl(url, index) {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(name || `reference-${index + 1}`);
  } catch {
    return `reference-${index + 1}`;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function executeDownload(tabId, step, timeoutMs) {
  const created = new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error("Timed out waiting for Flow export download")), timeoutMs);
    const listener = (item) => cleanup(null, item);
    function cleanup(error, item) {
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(listener);
      error ? reject(error) : resolve(item);
    }
    chrome.downloads.onCreated.addListener(listener);
  });

  const click = await sendPageAction(tabId, {
    action: "click",
    selector: step.params.selector,
    optional: false,
  }, Math.min(timeoutMs, 30000));
  if (!click.success) throw new Error(click.error || "Could not click Flow export/download control");

  const item = await created;
  await waitForDownloadComplete(item.id, timeoutMs);
  const finalItem = (await chrome.downloads.search({ id: item.id }))[0] || item;
  return { path: finalItem.filename || step.params.fileName || `download-${item.id}.mp4`, url: finalItem.finalUrl || finalItem.url };
}

function waitForDownloadComplete(id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error("Flow export download did not complete")), timeoutMs);
    const listener = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") cleanup();
      if (delta.state?.current === "interrupted") cleanup(new Error(delta.error?.current || "Download interrupted"));
    };
    function cleanup(error) {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.downloads.onChanged.addListener(listener);
  });
}
