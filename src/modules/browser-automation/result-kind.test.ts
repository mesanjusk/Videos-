import { describe, expect, it } from "vitest";
import { assetKindForMimeType } from "./extension-service";

describe("assetKindForMimeType", () => {
  it("files a captured still as an image", () => {
    expect(assetKindForMimeType("image/png")).toBe("image");
    expect(assetKindForMimeType("image/jpeg")).toBe("image");
  });

  it("files a clip as video, because Flow may answer an image request with one", () => {
    expect(assetKindForMimeType("video/mp4")).toBe("video");
  });

  it("files audio as audio, whatever the backend then calls it", () => {
    // Cloudinary has no audio resource type and stores it under video; that mapping belongs to the
    // provider, not here.
    expect(assetKindForMimeType("audio/mpeg")).toBe("audio");
  });

  it("falls back to raw rather than guessing", () => {
    // A page that served the result with no content-type is not a reason to refuse the bytes.
    expect(assetKindForMimeType(undefined)).toBe("raw");
    expect(assetKindForMimeType("")).toBe("raw");
    expect(assetKindForMimeType("application/octet-stream")).toBe("raw");
  });
});
