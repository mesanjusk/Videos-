const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(["apiBaseUrl", "extensionToken", "workerId", "enabled"]);
  $("apiBaseUrl").value = cfg.apiBaseUrl || "http://localhost:3000";
  $("extensionToken").value = cfg.extensionToken || "";
  $("enabled").checked = cfg.enabled === true;
  $("status").textContent = `Worker: ${cfg.workerId || "not initialized"}\n${cfg.enabled ? "Automatic claiming enabled" : "Automatic claiming disabled"}`;
}

$("save").addEventListener("click", async () => {
  const current = await chrome.storage.local.get(["workerId"]);
  const workerId = current.workerId || `chrome-${crypto.randomUUID()}`;
  await chrome.storage.local.set({
    apiBaseUrl: $("apiBaseUrl").value.trim().replace(/\/$/, ""),
    extensionToken: $("extensionToken").value.trim(),
    enabled: $("enabled").checked,
    workerId,
  });
  $("status").textContent = `Saved. Worker: ${workerId}`;
});

$("poll").addEventListener("click", async () => {
  $("status").textContent = "Checking for a pending Flow mission…";
  const response = await chrome.runtime.sendMessage({ type: "FLOW_RUNNER_POLL_NOW" });
  $("status").textContent = response?.ok ? "Claim cycle finished. Check Google Flow/task status." : `Claim failed: ${response?.error || "unknown error"}`;
});

void load();
