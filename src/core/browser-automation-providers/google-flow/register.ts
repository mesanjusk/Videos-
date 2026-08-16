import { browserProviderRegistry } from "@/core/browser-automation/provider-adapter";
import { GoogleFlowProviderAdapter } from "./adapter";

let registered = false;

/** Idempotent — safe to call more than once (e.g. hot reload re-evaluating worker.ts's module graph). */
export function registerGoogleFlowProvider(): void {
  if (registered) return;
  browserProviderRegistry.register(new GoogleFlowProviderAdapter());
  registered = true;
}
