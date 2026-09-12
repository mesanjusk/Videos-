import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import { recordExtensionResult } from "@/modules/browser-automation/extension-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where a Chrome extension mission hands back the file it produced.
 *
 * The third endpoint the extension needed and did not have. It could claim a task and report its
 * stage, but there was no way to deliver the actual result — so it reported the URL Chrome had
 * downloaded from and the server tried to fetch that, which cannot work: a `blob:` URL belongs to
 * a page that has since closed, and Flow's own asset URLs answer only a request carrying the
 * operator's cookies. The picture was real and sitting in someone's Downloads folder, permanently
 * out of reach of the job waiting for it.
 *
 * Raw bytes rather than JSON or multipart, deliberately: base64 in a JSON envelope inflates a file
 * by a third for no benefit, and a serverless function's request body is the scarcest thing in this
 * path. `content-type` carries the media type (it decides the storage bucket) and `x-file-name`
 * the name, which is all the metadata a captured result has.
 *
 * ## The size ceiling is real
 *
 * A Vercel serverless function accepts about 4.5MB of request body, which is comfortable for the
 * stills this path exists for and too small for a long clip. That is why it is capped and says so
 * plainly: a mission that produces something too big should fail with a sentence an operator can
 * act on, not a platform error with no author. Video generation does not come through here — it
 * runs on the worker, where Playwright saves files to a disk the server owns.
 */
const MAX_BYTES = 4 * 1024 * 1024;

function fileNameFrom(request: Request): string {
  const raw = (request.headers.get("x-file-name") ?? "").trim();
  // The extension chooses this string, so it is reduced to a basename with nothing path-like left
  // in it — the same treatment `core/browser/action-engine.ts#safeFileName` gives a name chosen by
  // a remote page, and for the same reason.
  const base = raw.split(/[/\\]/).pop() ?? "";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_");
  return safe || `flow-result-${Date.now()}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workerId = requireExtensionAuth(request);
    const { id } = await params;

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      return NextResponse.json(
        { error: `This result is ${Math.round(declared / 1024 / 1024)}MB; the limit for a captured file is 4MB.` },
        { status: 413 },
      );
    }

    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength === 0) return NextResponse.json({ error: "The request carried no bytes" }, { status: 400 });
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "The captured file is larger than the 4MB limit." }, { status: 413 });
    }

    const download = await recordExtensionResult(id, {
      workerId,
      fileName: fileNameFrom(request),
      mimeType: request.headers.get("content-type") ?? undefined,
      data: body,
    });
    if (!download) {
      return NextResponse.json({ error: "Task not found or not claimed by this extension" }, { status: 404 });
    }

    return NextResponse.json({ download });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/result]", err);
    return NextResponse.json({ error: "Failed to store the mission result" }, { status: 500 });
  }
}
