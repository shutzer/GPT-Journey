import { DemoImages, DemoProvider } from "./demo";
import { AIError, type ImageProvider, type Settings, type TextProvider } from "./types";

// Each provider SDK is loaded only when that provider is actually used.

export async function textProvider(s: Settings): Promise<TextProvider> {
  switch (s.text) {
    case "claude": {
      const { ClaudeProvider } = await import("./anthropic");
      return new ClaudeProvider(need(s.keys.claude, "Claude"), s.models.claude, s.claudeFallbacks);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai");
      return new OpenAIProvider(need(s.keys.openai, "OpenAI"), s.models.openai);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini");
      return new GeminiProvider(need(s.keys.gemini, "Gemini"), s.models.gemini);
    }
    case "demo":
      return new DemoProvider();
  }
}

export async function imageProvider(s: Settings): Promise<ImageProvider | null> {
  switch (s.image) {
    case "gemini": {
      if (!s.keys.gemini) return null;
      const { GeminiImages } = await import("./gemini");
      return new GeminiImages(s.keys.gemini, s.models.geminiImage);
    }
    case "openai": {
      if (!s.keys.openai) return null;
      const { OpenAIImages } = await import("./openai");
      return new OpenAIImages(s.keys.openai, s.models.openaiImage);
    }
    case "none":
      return s.text === "demo" ? new DemoImages() : null;
  }
}

export function modelLabel(s: Settings): string {
  return s.text === "demo" ? "demo" : s.models[s.text];
}

export async function listModels(provider: "claude" | "openai" | "gemini", key: string): Promise<string[]> {
  if (!key) throw new AIError("Enter an API key first.");
  switch (provider) {
    case "claude":
      return (await import("./anthropic")).listClaudeModels(key);
    case "openai":
      return (await import("./openai")).listOpenAIModels(key);
    case "gemini":
      return (await import("./gemini")).listGeminiModels(key);
  }
}

function need(key: string, name: string): string {
  if (!key.trim()) throw new AIError(`Add your ${name} API key in Settings, or switch to the offline demo.`);
  return key.trim();
}
