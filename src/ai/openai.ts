import OpenAI from "openai";
import {
  AIError,
  describeHttpError,
  parseJson,
  type ImageProvider,
  type JsonRequest,
  type StreamRequest,
  type TextProvider,
} from "./types";

type Fetch = typeof globalThis.fetch;

function client(apiKey: string, fetchImpl?: Fetch) {
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

export class OpenAIProvider implements TextProvider {
  readonly label = "OpenAI";
  private client: OpenAI;

  constructor(apiKey: string, private model: string, fetchImpl?: Fetch) {
    this.client = client(apiKey, fetchImpl);
  }

  async json(req: JsonRequest): Promise<unknown> {
    try {
      const response = await this.client.responses.create(
        {
          model: this.model,
          instructions: req.system,
          input: req.prompt,
          reasoning: { effort: req.effort },
          text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
        },
        { signal: req.signal },
      );
      if (response.status === "incomplete") throw new AIError("OpenAI's answer was cut off. Try again.");
      const refusal = response.output
        .flatMap((item) => (item.type === "message" ? item.content : []))
        .find((part) => part.type === "refusal");
      if (refusal) throw new AIError("OpenAI declined this request.");
      return parseJson(response.output_text);
    } catch (err) {
      throw describeHttpError("OpenAI", err);
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<string> {
    try {
      const stream = await this.client.responses.create(
        {
          model: this.model,
          instructions: req.system,
          input: req.messages.map((m) => ({ role: m.role, content: m.content })),
          reasoning: { effort: req.effort },
          stream: true,
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") yield event.delta;
        else if (event.type === "response.failed") throw new AIError("OpenAI failed to answer.");
      }
    } catch (err) {
      throw describeHttpError("OpenAI", err);
    }
  }
}

export class OpenAIImages implements ImageProvider {
  private client: OpenAI;

  constructor(apiKey: string, private model: string, fetchImpl?: Fetch) {
    this.client = client(apiKey, fetchImpl);
  }

  async generate(prompt: string, shape: "square" | "wide", signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.client.images.generate(
        { model: this.model, prompt, n: 1, size: shape === "wide" ? "1536x1024" : "1024x1024", quality: "medium" },
        { signal },
      );
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new AIError("OpenAI returned no image.");
      return `data:image/png;base64,${b64}`;
    } catch (err) {
      throw describeHttpError("OpenAI Images", err);
    }
  }
}

export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const model of client(apiKey).models.list()) ids.push(model.id);
  return ids.sort();
}
