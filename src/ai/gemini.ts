import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import {
  AIError,
  describeHttpError,
  parseJson,
  type Effort,
  type ImageProvider,
  type JsonRequest,
  type StreamRequest,
  type TextProvider,
} from "./types";

const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export class GeminiProvider implements TextProvider {
  readonly label = "Gemini";
  private ai: GoogleGenAI;

  constructor(apiKey: string, private model: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async json(req: JsonRequest): Promise<unknown> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: req.schema,
          thinkingConfig: { thinkingLevel: THINKING[req.effort] },
          abortSignal: req.signal,
        },
      });
      const reason = response.candidates?.[0]?.finishReason;
      if (reason === "MAX_TOKENS") throw new AIError("Gemini's answer was cut off. Try again.");
      if (!response.text) throw new AIError(`Gemini returned no answer${reason ? ` (${reason})` : ""}.`);
      return parseJson(response.text);
    } catch (err) {
      throw describeHttpError("Gemini", err);
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<string> {
    try {
      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        config: {
          systemInstruction: req.system,
          thinkingConfig: { thinkingLevel: THINKING[req.effort] },
          abortSignal: req.signal,
        },
      });
      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
    } catch (err) {
      throw describeHttpError("Gemini", err);
    }
  }
}

export class GeminiImages implements ImageProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string, private model: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(prompt: string, shape: "square" | "wide", signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: shape === "wide" ? "16:9" : "1:1" },
          abortSignal: signal,
        },
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new AIError("Gemini returned no image.");
      return `data:${part.inlineData.mimeType ?? "image/png"};base64,${part.inlineData.data}`;
    } catch (err) {
      throw describeHttpError("Gemini Images", err);
    }
  }
}

export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey });
  const ids: string[] = [];
  for await (const model of await ai.models.list()) {
    if (model.name) ids.push(model.name.replace(/^models\//, ""));
  }
  return ids.sort();
}
