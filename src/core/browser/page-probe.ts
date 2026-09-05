import type { Page, Frame } from "playwright";

/**
 * Live DOM discovery, and the stability wait that makes an action's result readable.
 *
 * ## Why a probe at all
 *
 * Every selector this codebase has for Google Flow is a guess. `providers/google-flow/selectors.ts`
 * says so in its own header: Flow publishes no DOM contract, and nobody here has an account to
 * verify against. The self-healing resolver softens that — several ways to find one element, and a
 * redesign has to break all of them — but every one of those ways is still a string written in
 * advance against a page nobody has seen.
 *
 * Probing inverts it. Ask the page what is actually on it, get back real controls with real
 * accessible names, and act on the one that matches. A workflow can then say "the button whose
 * accessible name looks like Generate" and be right on a page whose class names changed last
 * Tuesday.
 *
 * ## Refs
 *
 * Each probed element is stamped with `data-vs-ref="e12"` and reported as that ref. Acting by ref
 * closes the gap between "the element I was shown" and "an element matching the description of the
 * element I was shown" — the classic way an automation clicks the wrong one of five identical
 * buttons. The attribute lives on the node, so it survives a re-render that moves the element, and
 * a ref whose node has genuinely gone fails immediately and says so instead of silently resolving
 * to a different element.
 *
 * Ported from the element-ref mechanism in mesanjusk/automation's `packages/browser`.
 */

/** The attribute a probe stamps on each element it reports. */
export const REF_ATTRIBUTE = "data-vs-ref";

export interface ProbedElement {
  ref: string;
  tag: string;
  /** ARIA role, explicit or implicit. */
  role: string;
  /** Accessible name — aria-label, then label text, then trimmed text content. */
  name: string;
  /** Current value of an input/textarea/contenteditable, truncated. Never read from a password field. */
  value?: string;
  editable: boolean;
  disabled: boolean;
  /** A selector that addresses this element right now — useful to interpolate into a later step. */
  cssPath: string;
}

export interface PageProbe {
  url: string;
  title: string;
  elements: ProbedElement[];
  /** Text of any open dialog, so "a modal is covering the page" is diagnosable from the record. */
  dialogs: string[];
  /** How far the page can still scroll down, in pixels. */
  scrollRemaining: number;
}

/**
 * Reads every visible, interactive control on the page and stamps each with a ref.
 *
 * Same-origin iframes are included — Flow renders parts of its UI in them, and a probe that stops
 * at the top document reports an empty page and sends the run down the recovery path for no reason.
 * Cross-origin frames throw on access and are skipped; that is a browser boundary, not an error.
 */
export async function probePage(page: Page, limit = 120): Promise<PageProbe> {
  const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
  const elements: ProbedElement[] = [];
  const dialogs: string[] = [];

  for (const frame of frames) {
    if (elements.length >= limit) break;
    try {
      // Refs are numbered from a running offset rather than restarting at e1 per frame: two frames
      // both stamping `e1` would make a ref ambiguous, and `page.locator()` searches every frame.
      const result = await probeFrame(frame, limit - elements.length, elements.length);
      elements.push(...result.elements);
      dialogs.push(...result.dialogs);
    } catch {
      // Cross-origin frame, or one that navigated away mid-probe. Not an error worth failing on.
    }
  }

  const [url, title, scrollRemaining] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ""),
    page
      .evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
      })
      .catch(() => 0),
  ]);

  return { url, title, elements, dialogs, scrollRemaining };
}

async function probeFrame(frame: Frame, limit: number, refOffset: number) {
  return frame.evaluate(
    ({ attribute, max, offset }) => {
      const INTERACTIVE =
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], ' +
        '[role="menuitem"], [role="tab"], [role="checkbox"], [role="combobox"], [contenteditable="true"]';

      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
      };

      const accessibleName = (el: Element): string => {
        const aria = el.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const label = document.getElementById(labelledBy)?.textContent?.trim();
          if (label) return label;
        }
        if (el instanceof HTMLInputElement) {
          const label = el.labels?.[0]?.textContent?.trim();
          if (label) return label;
        }
        const placeholder = el.getAttribute("placeholder");
        if (placeholder?.trim()) return placeholder.trim();
        return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      };

      const implicitRole = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          const type = (el as HTMLInputElement).type;
          if (type === "checkbox" || type === "radio" || type === "button" || type === "submit") return type;
          if (type === "file") return "file";
          return "textbox";
        }
        return tag;
      };

      // A path built from stable-looking hooks first, falling back to nth-of-type. This is what a
      // later step interpolates when it needs to address the same element again.
      const cssPath = (el: Element): string => {
        const testId = el.getAttribute("data-testid");
        if (testId) return `[data-testid="${testId}"]`;
        const id = el.getAttribute("id");
        if (id && !/^\d/.test(id)) return `#${CSS.escape(id)}`;
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node !== document.body && parts.length < 5) {
          const parent: Element | null = node.parentElement;
          const tag = node.tagName.toLowerCase();
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
          node = parent;
        }
        return parts.join(" > ");
      };

      const elements: {
        ref: string;
        tag: string;
        role: string;
        name: string;
        value?: string;
        editable: boolean;
        disabled: boolean;
        cssPath: string;
      }[] = [];

      let counter = 0;
      for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
        if (elements.length >= max) break;
        if (!isVisible(el)) continue;

        const ref = `e${offset + ++counter}`;
        el.setAttribute(attribute, ref);

        const isPassword = el instanceof HTMLInputElement && el.type === "password";
        const rawValue =
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? el.value
            : el.getAttribute("contenteditable") === "true"
              ? (el.textContent ?? "")
              : undefined;

        elements.push({
          ref,
          tag: el.tagName.toLowerCase(),
          role: implicitRole(el),
          name: accessibleName(el),
          // A probe is persisted on the execution step and can be handed to a model. A password
          // field's contents must not travel with it — the name and role are enough to act on.
          value: isPassword ? undefined : rawValue?.slice(0, 200),
          editable:
            (el instanceof HTMLInputElement && !el.readOnly && !el.disabled) ||
            (el instanceof HTMLTextAreaElement && !el.readOnly && !el.disabled) ||
            el.getAttribute("contenteditable") === "true",
          disabled: (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true",
          cssPath: cssPath(el),
        });
      }

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'))
        .map((d) => (d.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
        .filter(Boolean);

      return { elements, dialogs };
    },
    { attribute: REF_ATTRIBUTE, max: limit, offset: refOffset },
  );
}

/**
 * Waits for the DOM to stop changing, then reports what changed.
 *
 * This is the other half of acting: without it, a click on a disabled control and a click that
 * opened a new screen are indistinguishable, and the run builds its next five steps on an action
 * that never happened. `NOTHING CHANGED` in the returned summary is a real, actionable result — it
 * is the signal that a selector resolved to the wrong element.
 */
export interface StabilityResult {
  settled: boolean;
  changed: boolean;
  summary: string;
}

export async function waitForStability(
  page: Page,
  opts: { quietMs?: number; timeoutMs?: number } = {},
): Promise<StabilityResult> {
  const quietMs = opts.quietMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const deadline = Date.now() + timeoutMs;

  const fingerprint = async () =>
    page
      .evaluate(() => ({
        url: location.href,
        nodes: document.querySelectorAll("*").length,
        text: (document.body?.innerText ?? "").length,
      }))
      .catch(() => null);

  const before = await fingerprint();
  let previous = before;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const current = await fingerprint();
    if (!current || !previous) break;
    const same = current.url === previous.url && current.nodes === previous.nodes && current.text === previous.text;
    if (same) {
      if (Date.now() - stableSince >= quietMs) {
        return { settled: true, ...describeChange(before, current) };
      }
    } else {
      stableSince = Date.now();
      previous = current;
    }
  }

  const final = await fingerprint();
  return { settled: false, ...describeChange(before, final) };
}

type Fingerprint = { url: string; nodes: number; text: number } | null;

function describeChange(before: Fingerprint, after: Fingerprint): { changed: boolean; summary: string } {
  if (!before || !after) return { changed: false, summary: "page state could not be read" };
  const notes: string[] = [];
  if (before.url !== after.url) notes.push(`URL changed to ${after.url}`);
  if (before.nodes !== after.nodes) notes.push(`${after.nodes - before.nodes > 0 ? "+" : ""}${after.nodes - before.nodes} elements`);
  if (before.text !== after.text) notes.push(`${after.text - before.text > 0 ? "+" : ""}${after.text - before.text} characters of text`);
  if (notes.length === 0) return { changed: false, summary: "NOTHING CHANGED — the last action had no visible effect" };
  return { changed: true, summary: notes.join("; ") };
}
