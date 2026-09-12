(() => {
  if (window.__VIDEOS_FLOW_EXECUTOR_INSTALLED__) return;
  window.__VIDEOS_FLOW_EXECUTOR_INSTALLED__ = true;
  const pendingUploads = new Map();
  const pendingCaptures = new Map();
  const CAPTURE_CHUNK_SIZE = 256 * 1024;

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

    if (action === "upload_begin") {
      const input = await waitForElement(payload.selector, 15000);
      if (!input) return optionalOrError(payload, `Upload input not found: ${payload.selector}`);
      if (!(input instanceof HTMLInputElement) || input.type !== "file") {
        return optionalOrError(payload, "Resolved upload target is not input[type=file]");
      }
      pendingUploads.set(payload.uploadId, {
        input,
        files: (payload.files || []).map((file) => ({ ...file, chunks: [] })),
      });
      return { success: true };
    }

    if (action === "upload_chunk") {
      const upload = pendingUploads.get(payload.uploadId);
      if (!upload) return { success: false, error: "Unknown upload session" };
      const file = upload.files.find((item) => item.fileId === payload.fileId);
      if (!file) return { success: false, error: "Unknown upload file" };
      file.chunks[payload.chunkIndex] = payload.base64;
      return { success: true };
    }

    // ── Capturing a result ──────────────────────────────────────────────────────────────────────
    //
    // The bytes of whatever Flow is displaying, read here rather than downloaded.
    //
    // This has to happen in the page. A generated result is served either from a `blob:` URL, which
    // only exists inside this document, or from a Google URL that answers only a request carrying
    // this session's cookies — and the service worker has neither. `chrome.downloads` was the old
    // answer and it puts the file on the operator's disk, where the application that asked for it
    // cannot reach it.
    //
    // Chunked back the same way uploads come in, because one runtime message carrying several
    // megabytes of base64 is how you find the message size limit the hard way.
    if (action === "capture_begin") {
      const el = await waitForElement(payload.selector, 30000);
      if (!el) return optionalOrError(payload, `No result element to capture: ${payload.selector}`);

      const src = el.currentSrc || el.src || el.querySelector?.("source[src]")?.src || "";
      if (!src) return optionalOrError(payload, "The result element has no source to read");
      // A <video> fed by MediaSource has a blob: URL that is not a Blob and cannot be fetched. Say
      // so precisely — it is a real limit of this approach, not a mystery failure.
      if (el instanceof HTMLMediaElement && src.startsWith("blob:") && !el.src) {
        return { success: false, error: "This result is a streamed video, which cannot be captured from the page." };
      }

      let blob;
      try {
        const response = await fetch(src, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        blob = await response.blob();
      } catch (error) {
        return { success: false, error: `Could not read the result from the page: ${error.message}` };
      }
      if (!blob.size) return { success: false, error: "The result read back empty" };

      const captureId = payload.captureId || crypto.randomUUID();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pendingCaptures.set(captureId, bytes);
      return {
        success: true,
        captureId,
        size: bytes.byteLength,
        mimeType: blob.type || mimeFromSrc(src),
        chunkSize: CAPTURE_CHUNK_SIZE,
        chunkCount: Math.ceil(bytes.byteLength / CAPTURE_CHUNK_SIZE),
      };
    }

    if (action === "capture_chunk") {
      const bytes = pendingCaptures.get(payload.captureId);
      if (!bytes) return { success: false, error: "Unknown capture session" };
      const start = Number(payload.chunkIndex) * CAPTURE_CHUNK_SIZE;
      return { success: true, base64: bytesToBase64(bytes.subarray(start, start + CAPTURE_CHUNK_SIZE)) };
    }

    if (action === "capture_end") {
      pendingCaptures.delete(payload.captureId);
      return { success: true };
    }

    if (action === "upload_commit") {
      const upload = pendingUploads.get(payload.uploadId);
      if (!upload) return { success: false, error: "Unknown upload session" };
      try {
        const transfer = new DataTransfer();
        for (const file of upload.files) {
          const parts = file.chunks.map(base64ToBytes);
          const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
          if (size !== file.size) throw new Error(`Upload size mismatch for ${file.name}: ${size} != ${file.size}`);
          transfer.items.add(new File(parts, file.name, { type: file.mimeType || "application/octet-stream" }));
        }
        upload.input.files = transfer.files;
        upload.input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        upload.input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return { success: true, detail: `Attached ${transfer.files.length} file(s)` };
      } finally {
        pendingUploads.delete(payload.uploadId);
      }
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

  /** Chunk-sized, so the intermediate string never approaches an argument-count limit. */
  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  /** Last-resort media type, when the response carried none. */
  function mimeFromSrc(src) {
    if (/\.png(\?|#|$)/i.test(src)) return "image/png";
    if (/\.jpe?g(\?|#|$)/i.test(src)) return "image/jpeg";
    if (/\.webp(\?|#|$)/i.test(src)) return "image/webp";
    if (/\.mp4(\?|#|$)/i.test(src)) return "video/mp4";
    return "application/octet-stream";
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
})();
