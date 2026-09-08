import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { imageFromMission } from "./flow-image";
import { buildGoogleFlowImageMission } from "@/core/browser/providers/google-flow/build-image-mission";

const execFileAsync = promisify(execFile);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
let clipBytes: Buffer;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "flow-image-test-"));
  const clipPath = path.join(dir, "clip.mp4");
  await execFileAsync(ffmpegPath as unknown as string, [
    "-nostdin", "-y",
    "-f", "lavfi",
    "-i", "color=c=blue:s=160x120:d=1:r=10",
    "-pix_fmt", "yuv420p",
    clipPath,
  ]);
  clipBytes = await readFile(clipPath);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});
afterEach(() => vi.unstubAllGlobals());

function respondWith(body: Buffer, contentType: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    })),
  );
}

describe("imageFromMission", () => {
  it("uses a still exactly as Flow returned it", async () => {
    respondWith(PNG_MAGIC, "image/png");
    const image = await imageFromMission({ downloads: [{ path: "/tmp/a.png", url: "https://x/a.png" }] });
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data as Buffer)).toEqual(PNG_MAGIC);
  });

  it("takes the first frame when Flow answers with a clip instead", async () => {
    // The tolerance that matters: an image mission that comes back as video is still the image
    // that was asked for, one frame in. Real ffmpeg, real clip.
    respondWith(clipBytes, "video/mp4");
    const image = await imageFromMission({ downloads: [{ path: "/tmp/a.mp4", url: "https://x/a.mp4" }] });

    expect(image.mimeType).toBe("image/png");
    expect((image.data as Buffer).subarray(0, 8)).toEqual(PNG_MAGIC);
  }, 60_000);

  it("reads the extension when the server sends no content type", async () => {
    respondWith(clipBytes, null);
    const image = await imageFromMission({ downloads: [{ path: "/tmp/a.mp4", url: "https://x/a.mp4" }] });
    expect(image.mimeType).toBe("image/png");
  }, 60_000);

  it("refuses a mission that finished with nothing attached", async () => {
    await expect(imageFromMission({ downloads: [] })).rejects.toThrow(/without a downloadable file/);
    await expect(imageFromMission({})).rejects.toThrow(/without a downloadable file/);
  });

  it("refuses an empty download rather than storing a zero-byte image", async () => {
    respondWith(Buffer.alloc(0), "image/png");
    await expect(
      imageFromMission({ downloads: [{ path: "/tmp/a.png", url: "https://x/a.png" }] }),
    ).rejects.toThrow(/empty file/);
  });
});

describe("buildGoogleFlowImageMission", () => {
  it("asks for one image, and accepts a clip as the answer", () => {
    const mission = buildGoogleFlowImageMission({ taskId: "t1", prompt: "a red bicycle" });
    const wait = mission.steps.find((s) => s.id === "wait-result");

    expect(mission.metadata?.missionType).toBe("google-flow-image");
    // Both result selectors, matching what imageFromMission is prepared to receive.
    expect(String(wait?.params.selector)).toContain("result-image");
    expect(String(wait?.params.selector)).toContain("video");
  });

  it("carries the prompt verbatim", () => {
    const mission = buildGoogleFlowImageMission({ taskId: "t1", prompt: "a red bicycle" });
    expect(mission.steps.find((s) => s.id === "enter-prompt")?.params.text).toBe("a red bicycle");
  });

  it("uploads references only when there are some", () => {
    const without = buildGoogleFlowImageMission({ taskId: "t1", prompt: "x" });
    expect(without.steps.some((s) => s.id === "upload-references")).toBe(false);

    const with_ = buildGoogleFlowImageMission({
      taskId: "t1",
      prompt: "x",
      referenceAssets: [{ url: "https://x/ref.png" }],
    });
    const upload = with_.steps.find((s) => s.id === "upload-references");
    expect(upload?.action).toBe("upload_url");
    expect(with_.metadata?.referenceCount).toBe(1);
  });

  it("probes the page before trusting a guessed selector", () => {
    // Every Flow selector is unverified. A failed run that recorded what was actually on the page
    // is fixable; one that only says "no match" is not.
    const mission = buildGoogleFlowImageMission({ taskId: "t1", prompt: "x" });
    const probe = mission.steps.findIndex((s) => s.action === "probe_page");
    const prompt = mission.steps.findIndex((s) => s.id === "enter-prompt");
    expect(probe).toBeGreaterThanOrEqual(0);
    expect(probe).toBeLessThan(prompt);
  });

  it("keeps what the image is for, so the result can be attached to it", () => {
    const mission = buildGoogleFlowImageMission({
      taskId: "t1",
      prompt: "x",
      imageTarget: { kind: "background", backgroundId: "b1" },
    });
    expect(mission.metadata?.imageTarget).toEqual({ kind: "background", backgroundId: "b1" });
  });
});
