# Videos Google Flow Runner

This MV3 Chrome extension is the browser execution client for the Videos project. The Videos backend/production engine creates structured scene instructions; the extension claims the resulting deterministic browser task and executes it in Google Flow.

## Architecture

`Videos UI -> production engine/Gemini -> Google Flow mission API -> extension task queue -> Chrome extension -> Google Flow -> scene generation -> Flow timeline/combine -> Flow MP4 export -> task status`

The extension does **not** call Gemini during normal execution. Deterministic selectors and semantic fallbacks are always tried first. If a structured `click`, `paste`, `input_text`, or `wait_for` step fails, the optional AI recovery mode can inspect only the currently visible interactive elements and ask Gemini to select a replacement element for that same planned action. The original prompt/text and mission are not regenerated.

This recovery path was synced from the newer `mesanjusk/Automation` extension changes through upstream commit `bc54e03e388f0ba50bb87ee40a88defc80720634`, including free-model fallback handling, zero-quota model skipping, empty-response recovery, thought-part extraction, and JSON parsing fallback.

The legacy Playwright Google Flow path and FFmpeg renderer remain in the repository for safety. New extension missions mark Google Flow as the final output system and FFmpeg as fallback/post-processing only. Do not delete legacy code until live Flow validation is complete.

## Task lifecycle

`pending -> claimed -> opening_flow -> uploading_assets -> generating -> combining -> exporting -> completed | failed`

Extension tasks use `executionTarget: "extension"` and are intentionally not inserted into the existing BullMQ browser-task worker queue. Claiming is atomic in MongoDB so the Chrome extension and the existing Playwright worker cannot race the same task.

## Configuration

Set a long random `BROWSER_EXTENSION_TOKEN` in the Videos deployment environment. Load this `/extension` directory as an unpacked Chrome extension, open its side panel, enter the Videos app base URL and the same token, then enable automatic claiming.

Optional AI recovery can be enabled separately in the side panel. Add a Gemini API key and model only if you want last-resort selector recovery. If AI recovery is disabled or no key is configured, the extension remains fully deterministic and fails normally when all selectors fail.

The extension polls the authenticated claim endpoint and reports every lifecycle stage back with its worker ID. Completed/failed task metadata also records whether any AI selector recoveries were used.

## Creating a Flow mission

POST already-planned scenes to:

`/api/browser-automation/google-flow/missions`

The route accepts `scenes`, optional `sharedAssets`, per-scene `referenceAssets`, `aspectRatio`, `language`, and `outputFileName`. It intentionally performs no Gemini call; planning stays upstream in the Videos production engine.

## Reference image/video uploads

Both `upload_file` and `upload_url` are supported by the extension. `upload_url` is the normal Videos handoff: the service worker fetches each asset with extension host permissions, transfers it to the Flow content script in 256 KiB chunks, reconstructs a browser `File`, puts it into a `DataTransfer`, assigns the result to Flow's `input[type=file]`, and dispatches `input` and `change` events.

This path is MIME-agnostic and supports image and video references, including `image/png`, `image/jpeg`, and `video/mp4`. The executor validates reconstructed byte size before attaching the file.

For signed URLs, the URL must still be valid when the extension claims the task and must be fetchable from the extension context. Very large assets still require enough local browser memory to construct the final `File` before Flow receives it.

## Google Flow UI stability

Google Flow does not publish a stable DOM selector contract. Selectors are centralized in `src/core/browser/providers/google-flow/selectors.ts` and use semantic/text alternatives. The exact current authenticated Flow DOM, timeline labels, and export controls must be validated in a real signed-in Flow session before this branch replaces the legacy production path globally.

If Google authentication/MFA or an anti-bot verification challenge appears, the runner should fail the task rather than attempting to bypass it. Manual account verification is required.
