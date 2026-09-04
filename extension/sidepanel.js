const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get([
    "apiBaseUrl",
    "extensionToken",
    "workerId",
    "enabled",
    "aiFallbackEnabled",
    "geminiApiKey",
    "geminiModel",
  ]);
  $("apiBaseUrl").value = cfg.apiBaseUrl || "http://localhost:3000";
  $("extensionToken").value = cfg.extensionToken || "";
  $("enabled").checked = cfg.enabled === true;
  $("aiFallbackEnabled").checked = cfg.aiFallbackEnabled === true;
  $("geminiApiKey").value = cfg.geminiApiKey || "";

  let model = cfg.geminiModel || "gemini-2.5-flash";
  if (model === "gemini-2.0-flash" || model === "gemini-1.5-flash" || model.includes("pro")) {
    model = "gemini-2.5-flash";
    await chrome.storage.local.set({ geminiModel: model });
  }
  $("geminiModel").value = model;

  $("status").textContent = `Worker: ${cfg.workerId || "not initialized"}\n${cfg.enabled ? "Automatic claiming enabled" : "Automatic claiming disabled"}\n${cfg.aiFallbackEnabled && cfg.geminiApiKey ? `AI recovery enabled (${model})` : "AI recovery disabled"}`;
}

$("save").addEventListener("click", async () => {
  const current = await chrome.storage.local.get(["workerId"]);
  const workerId = current.workerId || `chrome-${crypto.randomUUID()}`;
  let geminiModel = $("geminiModel").value.trim() || "gemini-2.5-flash";
  if (geminiModel === "gemini-2.0-flash" || geminiModel === "gemini-1.5-flash" || geminiModel.includes("pro")) {
    geminiModel = "gemini-2.5-flash";
  }
  await chrome.storage.local.set({
    apiBaseUrl: $("apiBaseUrl").value.trim().replace(/\/$/, ""),
    extensionToken: $("extensionToken").value.trim(),
    enabled: $("enabled").checked,
    workerId,
    aiFallbackEnabled: $("aiFallbackEnabled").checked,
    geminiApiKey: $("geminiApiKey").value.trim(),
    geminiModel,
  });
  $("geminiModel").value = geminiModel;
  $("status").textContent = `Saved. Worker: ${workerId}\n${$("enabled").checked ? "Automatic claiming enabled" : "Automatic claiming disabled"}\n${$("aiFallbackEnabled").checked && $("geminiApiKey").value.trim() ? `AI recovery enabled (${geminiModel})` : "AI recovery disabled"}`;
});

$("poll").addEventListener("click", async () => {
  $("status").textContent = "Checking for a pending Flow mission…";
  const response = await chrome.runtime.sendMessage({ type: "FLOW_RUNNER_POLL_NOW" });
  $("status").textContent = response?.ok ? "Claim cycle finished. Check Google Flow/task status." : `Claim failed: ${response?.error || "unknown error"}`;
});

void load();
