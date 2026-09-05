import { writeFile, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import type { ProviderAdapter } from "@/core/browser/provider-adapter";
import type { ActionEngine } from "@/core/browser/action-engine";
import type { BrowserTask, TaskStep } from "@/core/browser/types";
import type { RecoveryAction, RecoveryContext } from "@/core/browser/recovery-engine";
import { FLOW_TIMEOUTS_MS } from "./selectors";
import { probePage } from "@/core/browser/page-probe";
import { classifyFlowScreen, TERMINAL_SCREENS, type FlowScreen } from "./state";

interface FlowTaskMetadata {
  promptText: string;
  referenceImageUrls?: string[];
}

interface RunContext {
  promptText: string;
  referenceImagePaths: string[];
}

async function downloadReferenceImages(urls: string[], dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [index, url] of urls.entries()) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue; // best-effort — a missing reference shouldn't abort the whole run
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = join(dir, `reference-${index}.png`);
    await writeFile(path, buffer);
    paths.push(path);
  }
  return paths;
}

function requireSelector(selector: unknown, step: TaskStep): string {
  if (typeof selector !== "string" || !selector) {
    throw new Error(`Step ${step.id} (${step.action}) is missing a "selector" param`);
  }
  return selector;
}

function resolveText(params: Record<string, unknown>, ctx: RunContext | undefined, step: TaskStep): string {
  if (params.textFrom === "promptText") {
    if (!ctx) throw new Error(`Step ${step.id}: no run context (initialize() wasn't called for this page?)`);
    return ctx.promptText;
  }
  if (typeof params.text === "string") return params.text;
  throw new Error(`Step ${step.id} (${step.action}) needs "textFrom" or "text" in params`);
}

function resolveFiles(params: Record<string, unknown>, ctx: RunContext | undefined, step: TaskStep): string[] {
  if (params.filesFrom === "referenceImages") {
    if (!ctx) throw new Error(`Step ${step.id}: no run context (initialize() wasn't called for this page?)`);
    return ctx.referenceImagePaths;
  }
  if (Array.isArray(params.filePaths)) return params.filePaths.filter((p): p is string => typeof p === "string");
  throw new Error(`Step ${step.id} (${step.action}) needs "filesFrom" or "filePaths" in params`);
}

/**
 * Module 7B — the first real `ProviderAdapter` on top of the Module 7A framework (which shipped
 * zero adapters by design). Drives labs.google/flow generically through `TaskStep`/`ActionEngine`
 * instead of the hardcoded sequence in `core/automation/google-flow-driver.ts` (Module 4) — that's
 * what makes the step sequence data (buildable from outside this codebase, e.g. the Claude Code
 * plugin's `run_google_flow_browser_task` MCP tool) instead of one fixed code path.
 *
 * Deliberately does NOT replace Module 4's `scene_video_auto` — that path is a complete,
 * already-working Scene-to-Cloudinary pipeline (see `core/queue/processors/scene-video-auto.processor.ts`).
 * This adapter is the generic entry point (`POST /api/browser-automation/tasks` with
 * `providerId: "google-flow"`) for ad hoc Flow automation with no Scene attached — "get me a clip
 * for this prompt" — surfaced on the Browser Automation Dashboard (Module 7A) and from the plugin.
 *
 * Same honest caveat as `core/automation/selectors.ts`: labs.google/flow has no public API or
 * documented DOM contract, and this codebase has no live Google account to verify selectors
 * against. Reuses that file's `FLOW_SELECTORS`/`FLOW_TIMEOUTS_MS` rather than duplicating a second
 * guess at them, so recalibrating against the real product means editing one file for both
 * automation paths.
 *
 * `browserProviderRegistry` (register.ts) holds one shared instance per worker process — the
 * `contexts` map below is keyed by `Page`, not by task/run id, because `executeAction`/
 * `verifyResult` receive only `(page, step, engine)`, not the task — a `WeakMap<Page, RunContext>`
 * is what lets one adapter instance safely serve several concurrent runs (`worker.ts` runs the
 * `browser_task` queue at `concurrency: 2`), each with its own `Page`, without cross-run state leaks.
 */
export class GoogleFlowProviderAdapter implements ProviderAdapter {
  readonly id = "google-flow";
  readonly label = "Google Flow (Veo)";

  private readonly contexts = new WeakMap<Page, RunContext>();

  async initialize({ page, task }: { page: Page; task: BrowserTask }): Promise<void> {
    page.setDefaultTimeout(FLOW_TIMEOUTS_MS.interaction);

    const metadata = (task.metadata ?? {}) as Partial<FlowTaskMetadata>;
    if (!metadata.promptText?.trim()) throw new Error("google-flow task is missing metadata.promptText");

    const tmpDir = await mkdtemp(join(tmpdir(), "flow-task-"));
    const referenceImagePaths = await downloadReferenceImages(metadata.referenceImageUrls ?? [], tmpDir);
    this.contexts.set(page, { promptText: metadata.promptText, referenceImagePaths });
  }

  async validate(task: BrowserTask): Promise<{ valid: boolean; reason?: string }> {
    const metadata = (task.metadata ?? {}) as Partial<FlowTaskMetadata>;
    if (!metadata.promptText?.trim()) return { valid: false, reason: "task.metadata.promptText is required" };
    if (task.steps.length === 0) return { valid: false, reason: "task has no steps" };
    return { valid: true };
  }

  async executeAction(page: Page, step: TaskStep, engine: ActionEngine): Promise<Record<string, unknown> | void> {
    const ctx = this.contexts.get(page);
    const params = step.params;
    const selector = params.selector;

    switch (step.action) {
      case "navigate":
        await engine.navigate(page, String(params.url));
        return;
      case "click":
        await engine.click(page, requireSelector(selector, step));
        return;
      case "double_click":
        await engine.doubleClick(page, requireSelector(selector, step));
        return;
      case "right_click":
        await engine.rightClick(page, requireSelector(selector, step));
        return;
      case "hover":
        await engine.hover(page, requireSelector(selector, step));
        return;
      case "input_text":
        await engine.inputText(page, requireSelector(selector, step), resolveText(params, ctx, step));
        return;
      case "paste":
        await engine.paste(page, requireSelector(selector, step), resolveText(params, ctx, step));
        return;
      case "keyboard_shortcut":
        await engine.keyboardShortcut(page, String(params.keys));
        return;
      case "upload_file": {
        const files = resolveFiles(params, ctx, step);
        await engine.uploadFile(page, requireSelector(selector, step), files);
        // Best-effort cleanup right after the files are consumed — this adapter is a long-lived
        // singleton in worker.ts, so downloaded references shouldn't linger in /tmp across runs.
        // Not done in shutdown(): that method isn't passed a page/task to key cleanup by (see the
        // class doc comment), so "right after use" is the only point that's actually scoped correctly.
        await Promise.all(files.map((f) => unlink(f).catch(() => {})));
        return;
      }
      case "download_file": {
        const result = await engine.downloadFile(page, requireSelector(selector, step));
        return { downloadPath: result.path };
      }
      case "scroll":
        await engine.scroll(page, typeof selector === "string" ? selector : undefined, typeof params.deltaY === "number" ? params.deltaY : undefined);
        return;
      case "drag":
        await engine.drag(page, requireSelector(selector, step), String(params.toSelector));
        return;
      case "wait":
        await engine.wait(page, requireSelector(selector, step), step.timeoutMs);
        return;
      case "sleep":
        await engine.sleep(typeof params.ms === "number" ? params.ms : 1000);
        return;
      case "screenshot": {
        const path = await engine.captureScreenshot(page, typeof params.name === "string" ? params.name : undefined);
        return { screenshotPath: path };
      }
      case "capture_html":
        return { html: await engine.captureHtml(page) };
      case "capture_dom":
        return { dom: await engine.captureDom(page) };
      case "probe_page": {
        // Reads what is genuinely on the page and stamps a ref on each control. Recorded on the
        // execution step, so a run that later fails can be diagnosed against the page as it
        // actually was, not against the selector file's idea of it.
        const probe = await probePage(page, typeof params.limit === "number" ? params.limit : undefined);
        return { probe: probe as unknown as Record<string, unknown> };
      }
      case "wait_for_state":
        return { screen: await this.waitForScreen(page, step) };
      default:
        throw new Error(`Unsupported action for google-flow: ${step.action}`);
    }
  }

  /** Flow's own screens, so a `wait_for_state` step can wait on a meaning. See ./state.ts. */
  async classifyState(page: Page): Promise<string> {
    return classifyFlowScreen(page);
  }

  /**
   * Polls until the page reaches one of the screens the step is waiting for.
   *
   * Three outcomes, and the difference between them is the whole point of doing it this way:
   * the wanted screen (return, carry on), a screen a run can never proceed from — signed out, a
   * human-verification challenge, Flow's own error state — which fails *immediately* with the
   * reason instead of burning the full timeout, and the timeout itself, which reports the screen it
   * was actually looking at when it gave up rather than the name of a selector.
   */
  private async waitForScreen(page: Page, step: TaskStep): Promise<FlowScreen> {
    const wanted = (Array.isArray(step.params.states) ? step.params.states : [step.params.state])
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((s) => s as FlowScreen);
    if (wanted.length === 0) throw new Error(`Step ${step.id} (wait_for_state) needs "state" or "states" in params`);

    const timeoutMs = step.timeoutMs ?? FLOW_TIMEOUTS_MS.render;
    const pollMs = typeof step.params.pollMs === "number" ? step.params.pollMs : 2000;
    const deadline = Date.now() + timeoutMs;
    let screen: FlowScreen = "UNKNOWN";

    while (Date.now() < deadline) {
      screen = await classifyFlowScreen(page);
      if (wanted.includes(screen)) return screen;

      const blocked = TERMINAL_SCREENS[screen];
      // Only when the step wasn't itself waiting for that screen — a run may legitimately wait for
      // SIGNED_OUT to confirm a sign-out happened.
      if (blocked) throw new Error(blocked);

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Google Flow to reach ${wanted.join(" or ")}; ` +
        `it is showing ${screen}`,
    );
  }

  async verifyResult(page: Page, step: TaskStep): Promise<boolean> {
    if (!step.verify) return true;
    const { type, params } = step.verify;
    if (type === "selector_visible") {
      const selector = String(params.selector ?? "");
      return page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false);
    }
    if (type === "url_matches") {
      return page.url().includes(String(params.pattern ?? ""));
    }
    return true; // "custom" — no generic way to verify without provider-specific knowledge beyond this
  }

  async recover(context: RecoveryContext): Promise<RecoveryAction> {
    // Not currently invoked by DefaultTaskEngine's composition — recovery there goes through the
    // separately injected RecoveryEngine (see core/queue/processors/browser-task.processor.ts),
    // not provider.recover(). Implemented for interface completeness, mirroring the same policy
    // DefaultRecoveryEngine already applies, in case a future caller does invoke it directly.
    if (context.attempt >= 3 || context.step.retryable === false) return { type: "abort" };
    return context.trigger === "timeout" || context.trigger === "popup" ? { type: "retry_action" } : { type: "abort" };
  }

  async shutdown(): Promise<void> {
    // No per-run context to target here — see the class doc comment on why cleanup instead happens
    // right after each upload_file step consumes its files.
  }
}
