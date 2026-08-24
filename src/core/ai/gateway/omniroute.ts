/**
 * OmniRoute — an optional OpenAI-compatible gateway in front of whatever models an operator has
 * configured there.
 *
 * ## What this is and is not
 *
 * It is a transport: one more route the `AiGateway` can select, speaking the OpenAI chat-completions
 * shape. Anything else that speaks that shape — a self-hosted vLLM, Ollama's compatible endpoint, a
 * different gateway — works through the same client by pointing `OMNIROUTE_BASE_URL` at it.
 *
 * It is **not** a way to make providers free. A gateway's cost is whatever upstream it selects, and
 * this application cannot see which that was, so `provider-metadata.ts` classifies it `unknown` and
 * ZERO_COST refuses it by default. `OMNIROUTE_ZERO_COST_MODELS` is the deliberate exception: an
 * operator who *has* verified that a specific model on their gateway costs nothing can name it, and
 * only those models become ZERO_COST-eligible. Verification is theirs to do; this code cannot.
 *
 * Optional in the strict sense: with `ENABLE_OMNIROUTE` off or `OMNIROUTE_BASE_URL` unset the
 * client reports itself unavailable and nothing else changes. Local development never needs it.
 */

export interface OmniRouteMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OmniRouteCompletionRequest {
  model?: string;
  messages: OmniRouteMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface OmniRouteCompletion {
  text: string;
  model: string;
  /** Present only when the gateway reports it; never invented. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** Which upstream actually served the request, when the gateway says so. */
  upstreamProvider?: string;
}

export function isOmniRouteConfigured(): boolean {
  return Boolean(process.env.OMNIROUTE_BASE_URL);
}

/** Models the operator has verified cost nothing on their gateway. Empty by default. */
export function zeroCostEligibleModels(): string[] {
  return (process.env.OMNIROUTE_ZERO_COST_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export function isModelZeroCostEligible(model: string): boolean {
  return zeroCostEligibleModels().includes(model);
}

export class OmniRouteClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;

  constructor(options: { baseUrl?: string; apiKey?: string; defaultModel?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OMNIROUTE_BASE_URL ?? "").replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.OMNIROUTE_API_KEY;
    this.defaultModel = options.defaultModel ?? process.env.OMNIROUTE_DEFAULT_MODEL ?? "auto";
  }

  isAvailable(): boolean {
    return Boolean(this.baseUrl);
  }

  /** Cheap reachability probe for the System Health page. Never throws. */
  async health(): Promise<"up" | "down" | "unknown"> {
    if (!this.isAvailable()) return "unknown";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers(), signal: controller.signal });
        return res.ok ? "up" : "down";
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return "down";
    }
  }

  async complete(request: OmniRouteCompletionRequest): Promise<OmniRouteCompletion> {
    if (!this.isAvailable()) {
      throw new Error("OmniRoute is not configured — set OMNIROUTE_BASE_URL, or route this capability elsewhere.");
    }
    const model = request.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OmniRoute returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }

    const body = (await response.json()) as {
      model?: string;
      provider?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error("OmniRoute returned no completion text.");
    }

    return {
      text,
      model: body.model ?? model,
      upstreamProvider: body.provider,
      usage: body.usage
        ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined,
    };
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}
