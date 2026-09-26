export type Effort = "low" | "medium" | "high";

export interface JsonRequest {
  system: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort: Effort;
  signal?: AbortSignal;
  /** Called as output streams in, with the number of characters received so far. */
  onProgress?: (chars: number) => void;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  system: string;
  messages: ChatMessage[];
  effort: Effort;
  signal?: AbortSignal;
}

/** Yielded by `stream()` when everything streamed so far must be discarded. */
export const RESET = "\u0000reset";

export interface TextProvider {
  readonly label: string;
  /** Structured output: resolves to the parsed (not yet validated) JSON value. */
  json(req: JsonRequest): Promise<unknown>;
  /** Plain text, streamed as it is generated. */
  stream(req: StreamRequest): AsyncIterable<string>;
}

export interface ImageProvider {
  /** Resolves to a data: URL. */
  generate(prompt: string, shape: "square" | "wide", signal?: AbortSignal): Promise<string>;
}

export type TextProviderId = "claude" | "openai" | "gemini" | "demo";
export type ImageProviderId = "gemini" | "openai" | "none";

export interface Settings {
  text: TextProviderId;
  image: ImageProviderId;
  keys: { claude: string; openai: string; gemini: string };
  models: {
    claude: string;
    openai: string;
    gemini: string;
    openaiImage: string;
    geminiImage: string;
  };
  /** Claude only: re-run declined requests on Anthropic's recommended fallback model. */
  claudeFallbacks: boolean;
  rememberKeys: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  text: "demo",
  image: "none",
  keys: { claude: "", openai: "", gemini: "" },
  models: {
    claude: "claude-opus-5",
    openai: "gpt-5.6",
    gemini: "gemini-3-flash-preview",
    openaiImage: "gpt-image-2",
    geminiImage: "gemini-3.1-flash-image",
  },
  claudeFallbacks: true,
  rememberKeys: false,
};

/** A failure whose message is safe and useful to show the player. */
export class AIError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIError";
  }
}

export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new AIError("The model returned malformed JSON.", { cause: err });
  }
}

export function describeHttpError(provider: string, err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof DOMException && err.name === "AbortError") return new AIError("Cancelled.", { cause: err });
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return new AIError(`${provider} rejected the API key.`, { cause: err });
  if (status === 404) return new AIError(`${provider}: model not found. Pick another model in Settings.`, { cause: err });
  if (status === 429) return new AIError(`${provider} rate limit or quota reached. Wait a moment and retry.`, { cause: err });
  if (status && status >= 500) return new AIError(`${provider} is having trouble (${status}). Retry shortly.`, { cause: err });
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch|network|Failed to fetch|connection/i.test(msg))
    return new AIError(`Could not reach ${provider}. Check your connection.`, { cause: err });
  return new AIError(`${provider} error: ${msg}`, { cause: err });
}
