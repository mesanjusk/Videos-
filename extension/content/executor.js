(() => {
  if (window.__VIDEOS_FLOW_EXECUTOR_INSTALLED__) return;
  window.__VIDEOS_FLOW_EXECUTOR_INSTALLED__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "VIDEOS_FLOW_ACTION") return false;
    execute(message.payload).then(sendResponse).catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  });

  async function execute(payload) {
    const action = payload.action;
    if (action === "sleep") {
      await delay(Number(payload.ms || 1000));
      return { success: true };
    }

    if (action === "wait") {
      const el = await waitForElement(payload.selector, 30000);
      return el ? { success: true } : optionalOrError(payload, `Element not found: ${payload.selector}`);
    }

    if (action === "upload") {
      const input = await waitForElement(payload.selector, 15000);
      if (!input) return optionalOrError(payload, `Upload input not found: ${payload.selector}`);
      if (!(input instanceof HTMLInputElement) || input.type !== "file") {
        return optionalOrError(payload, "Resolved upload target is not input[type=file]");
      }
      const transfer = new DataTransfer();
      for (const file of payload.files || []) {
        const bytes = base64ToBytes(file.base64);
        transfer.items.add(new File([bytes], file.name, { type: file.mimeType || "application/octet-stream" }));
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return { success: true, detail: `Attached ${transfer.files.length} file(s)` };
    }

    const el = await waitForElement(payload.selector, 15000);
    if (!el) return optionalOrError(payload, `Element not found: ${payload.selector}`);
    el.scrollIntoView({ block: "center", behavior: "instant" });

    if (action === "click") {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
      el.click();
      return { success: true };
    }

    if (action === "paste" || action === "input_text") {
      setText(el, String(payload.text ?? ""));
      return { success: true };
    }

    if (action === "hover") {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, composed: true }));
      return { success: true };
    }

    if (action === "scroll") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return { success: true };
    }

    return optionalOrError(payload, `Unsupported extension action: ${action}`);
  }

  function optionalOrError(payload, error) {
    return payload.optional ? { success: true, skipped: true, detail: error } : { success: false, error };
  }

  async function waitForElement(selector, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = resolveSelector(selector);
      if (el) return el;
      await delay(250);
    }
    return null;
  }

  function resolveSelector(selector) {
    if (!selector) return null;
    for (const alternative of splitAlternatives(selector)) {
      const trimmed = alternative.trim();
      if (!trimmed) continue;
      const textRegex = trimmed.match(/^text=\/(.+)\/([gimsuy]*)$/);
      if (textRegex) {
        const regex = new RegExp(textRegex[1], textRegex[2]);
        const hit = [...document.querySelectorAll("button, [role='button'], [role='menuitem'], a, div, span")]
          .find((node) => regex.test((node.textContent || "").trim()));
        if (hit) return hit;
        continue;
      }
      const hasText = trimmed.match(/^(.*):has-text\(["'](.+)["']\)$/);
      if (hasText) {
        const base = hasText[1] || "*";
        const needle = hasText[2].toLowerCase();
        try {
          const hit = [...document.querySelectorAll(base)].find((node) => (node.textContent || "").toLowerCase().includes(needle));
          if (hit) return hit;
        } catch {}
        continue;
      }
      try {
        const hit = document.querySelector(trimmed);
        if (hit) return hit;
      } catch {}
    }
    return null;
  }

  /** Splits selector fallbacks without splitting commas inside CSS attribute/functional expressions. */
  function splitAlternatives(value) {
    const result = [];
    let current = "";
    let square = 0;
    let round = 0;
    let quote = null;
    for (const ch of value) {
      if (quote) {
        current += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
      if (ch === "[") square += 1;
      if (ch === "]") square -= 1;
      if (ch === "(") round += 1;
      if (ch === ")") round -= 1;
      if (ch === "," && square === 0 && round === 0) { result.push(current); current = ""; continue; }
      current += ch;
    }
    if (current) result.push(current);
    return result;
  }

  function setText(target, value) {
    const el = findEditable(target);
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false);
    if (!document.execCommand("insertText", false, value)) el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  }

  function findEditable(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return el;
    return el.querySelector?.("textarea, input:not([type=hidden]), [contenteditable=true], [role=textbox]") || el;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
})();
