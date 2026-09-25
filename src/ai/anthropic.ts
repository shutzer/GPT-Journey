import Anthropic from "@anthropic-ai/sdk";
import { AIError, describeHttpError, parseJson, RESET, type Effort, type JsonRequest, type StreamRequest, type TextProvider } from "./types";

type Fetch = typeof globalThis.fetch;

export class ClaudeProvider implements TextProvider {
  readonly label = "Claude";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
    private fallbacks: boolean,
    fetchImpl?: Fetch,
  ) {
    // Bring-your-own-key app: the key never leaves the player's browser except to Anthropic.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  private params(effort: Effort) {
    return {
      model: this.model,
      thinking: { type: "adaptive" as const },
      output_config: { effort },
      ...(this.fallbacks
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    };
  }

  async json(req: JsonRequest): Promise<unknown> {
    try {
      // Case files are long; stream so large outputs never hit an HTTP timeout.
      const stream = this.client.beta.messages.stream(
        {
          ...this.params(req.effort),
          max_tokens: 32000,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
        },
        { signal: req.signal },
      );
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new AIError("Claude declined this request.");
      if (message.stop_reason === "max_tokens") throw new AIError("Claude's answer was cut off. Try again.");
      // Only blocks after the last fallback marker come from the model that answered.
      const start = message.content.findLastIndex((b) => b.type === "fallback") + 1;
      const text = message.content
        .slice(start)
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      return parseJson(text);
    } catch (err) {
      throw describeHttpError("Claude", err);
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<string> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          ...this.params(req.effort),
          max_tokens: 8000,
          system: req.system,
          messages: req.messages,
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
        // A refusal fallback switched models mid-answer: the text so far belongs to the model that declined.
        else if (event.type === "content_block_start" && event.content_block.type === "fallback") yield RESET;
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new AIError("Claude declined to answer that.");
    } catch (err) {
      throw describeHttpError("Claude", err);
    }
  }
}

export async function listClaudeModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id);
  return ids;
}
