const DEFAULTS = {
  apiBaseUrl: "http://localhost:3000",
  extensionToken: "",
  workerId: `chrome-${crypto.randomUUID()}`,
  enabled: false,
};

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
        const files = await resolveUploadFiles(step, task.metadata || {});
        const result = await sendPageAction(tabId, {
          action: "upload",
          selector: step.params.selector,
          files,
          optional: step.params.optional === true,
        }, step.timeoutMs);
        if (!result.success) throw new Error(result.error || `Upload failed at ${step.id}`);
        continue;
      }

      if (step.action === "download_file") {
        const download = await executeDownload(tabId, step, step.timeoutMs || 120000);
        downloads.push(download);
        continue;
      }

      const result = await sendPageAction(tabId, {
        action: step.action,
        selector: step.params.selector,
        text: step.params.text ?? resolveTextFrom(step.params.textFrom, task.metadata || {}),
        ms: step.params.ms,
        optional: step.params.optional === true,
      }, step.timeoutMs);
      if (!result.success && step.params.optional !== true) {
        throw new Error(result.error || `Action ${step.action} failed at ${step.id}`);
      }
    }

    await report(taskId, "completed", {
      currentStepIndex: task.steps.length,
      downloads,
      resultMetadata: { completedBy: "chrome-extension", completedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("[Videos Flow Runner] task failed", error);
    await report(taskId, "failed", {
      error: error instanceof Error ? error.message : String(error),
      downloads,
      resultMetadata: { failedBy: "chrome-extension", failedAt: new Date().toISOString() },
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

function resolveTextFrom(source, metadata) {
  if (!source) return undefined;
  return metadata[source];
}

async function resolveUploadFiles(step, metadata) {
  let specs = [];
  if (Array.isArray(step.params.files)) specs = step.params.files;
  else if (typeof step.params.url === "string") specs = [{ url: step.params.url, fileName: step.params.fileName, mimeType: step.params.mimeType }];
  else if (step.params.filesFrom === "referenceImages") {
    specs = (metadata.referenceImageUrls || []).map((url) => ({ url }));
  }
  if (!specs.length) throw new Error(`No upload files resolved for ${step.id}`);

  return Promise.all(specs.map(async (spec, index) => {
    const response = await fetch(spec.url);
    if (!response.ok) throw new Error(`Could not fetch reference asset (${response.status}): ${spec.url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      name: spec.fileName || fileNameFromUrl(spec.url, index),
      mimeType: spec.mimeType || response.headers.get("content-type") || "application/octet-stream",
      base64: bytesToBase64(bytes),
    };
  }));
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
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
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
