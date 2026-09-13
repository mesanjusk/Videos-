import { describe, expect, it, vi, afterEach } from "vitest";
import { videoFromMission } from "./flow-video";

function respondWith(body: string, contentType: string | null, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("videoFromMission", () => {
  it("returns the clip in the shape the scene pipeline completes with", async () => {
    respondWith("mp4-bytes", "video/mp4");
    const clip = await videoFromMission({ downloads: [{ path: "clip.mp4", url: "https://cdn.test/clip.mp4" }] });

    expect(clip.status).toBe("completed");
    expect(clip.mimeType).toBe("video/mp4");
    expect(clip.data.toString()).toBe("mp4-bytes");
    expect(clip.durationSeconds).toBe(8);
  });

  it("refuses a still where a clip was asked for", async () => {
    // The image path accepts a clip and takes its first frame, because both answer "draw me this".
    // The reverse is not true: a one-frame file in the timeline is a frozen scene reported as done.
    respondWith("png-bytes", "image/png");
    await expect(
      videoFromMission({ downloads: [{ path: "still.png", url: "https://cdn.test/still.png" }] }),
    ).rejects.toThrow(/cannot stand in for a scene/i);
  });

  it("trusts the extension's file extension when the server sends no type", async () => {
    respondWith("mp4-bytes", null);
    const clip = await videoFromMission({ downloads: [{ path: "clip.mp4", url: "https://cdn.test/clip.mp4" }] });
    expect(clip.mimeType).toBe("video/mp4");
  });

  it("says so plainly when the mission finished with nothing attached", async () => {
    await expect(videoFromMission({ downloads: [] })).rejects.toThrow(/without a downloadable file/i);
    await expect(videoFromMission({ downloads: [{ path: "clip.mp4" }] })).rejects.toThrow(/without a downloadable file/i);
  });

  it("reports a download that failed rather than storing an error page as a clip", async () => {
    respondWith("nope", "text/html", false);
    await expect(
      videoFromMission({ downloads: [{ path: "clip.mp4", url: "https://cdn.test/clip.mp4" }] }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
