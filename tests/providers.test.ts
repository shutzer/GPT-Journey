import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider } from "../src/ai/anthropic";
import { GeminiImages, GeminiProvider } from "../src/ai/gemini";
import { OpenAIImages, OpenAIProvider } from "../src/ai/openai";
import { AIError, RESET } from "../src/ai/types";

// Each test drives a real SDK against a fake `fetch` and checks what goes over the wire both ways.

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

interface Captured {
  url: string;
  headers: Headers;
  body: any;
}

function fakeFetch(respond: (c: Captured) => Response) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    const c = { url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null };
    calls.push(c);
    return respond(c);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const sse = (events: Array<[string | null, unknown]>) =>
  new Response(events.map(([e, d]) => `${e ? `event: ${e}\n` : ""}data: ${JSON.stringify(d)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });

function claudeStream(blocks: Array<{ type: string; text?: string; extra?: object }>, stop = "end_turn") {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
  ];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }]);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: b.type, ...b.extra } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return sse(events);
}

describe("Claude", () => {
  it("json: structured output, adaptive thinking, effort and fallbacks", async () => {
    const { fn, calls } = fakeFetch(() => claudeStream([{ type: "text", text: '{"ok":' }, { type: "text", text: "true}" }]));
    const p = new ClaudeProvider("sk-test", "claude-opus-5", true, fn);
    await expect(p.json({ system: "sys", prompt: "hi", schemaName: "x", schema, effort: "high" })).resolves.toEqual({ ok: true });
    const { body, headers, url } = calls[0];
    expect(url).toMatch(/\/v1\/messages/);
    expect(body.model).toBe("claude-opus-5");
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema } });
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("x-api-key")).toBe("sk-test");
  });

  it("json: ignores text from a model that declined before a fallback", async () => {
    const { fn } = fakeFetch(() =>
      claudeStream([
        { type: "text", text: '{"ok":fal' },
        { type: "fallback", extra: { from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" } } },
        { type: "text", text: '{"ok":true}' },
      ]),
    );
    const p = new ClaudeProvider("k", "claude-opus-5", true, fn);
    await expect(p.json({ system: "", prompt: "", schemaName: "x", schema, effort: "low" })).resolves.toEqual({ ok: true });
  });

  it("stream: yields text, RESET on fallback, and surfaces refusals", async () => {
    const { fn } = fakeFetch(() =>
      claudeStream([{ type: "text", text: "Hel" }, { type: "fallback", extra: { from: { model: "a" }, to: { model: "b" } } }, { type: "text", text: "Hello" }]),
    );
    const p = new ClaudeProvider("k", "claude-opus-5", false, fn);
    const out: string[] = [];
    for await (const chunk of p.stream({ system: "", messages: [{ role: "user", content: "hi" }], effort: "low" })) out.push(chunk);
    expect(out).toEqual(["Hel", RESET, "Hello"]);

    const refused = new ClaudeProvider("k", "claude-opus-5", false, fakeFetch(() => claudeStream([], "refusal")).fn);
    await expect(refused.json({ system: "", prompt: "", schemaName: "x", schema, effort: "low" })).rejects.toThrow(/declined/);
  });

  it("maps HTTP errors to readable messages", async () => {
    const { fn } = fakeFetch(() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const p = new ClaudeProvider("k", "claude-opus-5", false, fn);
    const call = p.json({ system: "", prompt: "", schemaName: "x", schema, effort: "low" });
    await expect(call).rejects.toBeInstanceOf(AIError);
    await expect(call).rejects.toThrow(/rejected the API key/);
  });
});

describe("OpenAI", () => {
  it("json: Responses API with strict json_schema", async () => {
    const { fn, calls } = fakeFetch(() =>
      Response.json({
        id: "resp_1", object: "response", status: "completed", model: "gpt-5.6",
        output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] }],
      }),
    );
    const p = new OpenAIProvider("sk-o", "gpt-5.6", fn);
    await expect(p.json({ system: "sys", prompt: "hi", schemaName: "case_file", schema, effort: "medium" })).resolves.toEqual({ ok: true });
    const { body, url, headers } = calls[0];
    expect(url).toMatch(/\/responses$/);
    expect(body.instructions).toBe("sys");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.text.format).toEqual({ type: "json_schema", name: "case_file", schema, strict: true });
    expect(headers.get("authorization")).toBe("Bearer sk-o");
  });

  it("stream: yields output_text deltas", async () => {
    const { fn, calls } = fakeFetch(() =>
      sse([
        [null, { type: "response.output_text.delta", delta: "Good ", item_id: "m", output_index: 0, content_index: 0, sequence_number: 1 }],
        [null, { type: "response.output_text.delta", delta: "evening.", item_id: "m", output_index: 0, content_index: 0, sequence_number: 2 }],
        [null, { type: "response.completed", sequence_number: 3, response: { id: "r", output: [] } }],
      ]),
    );
    const p = new OpenAIProvider("k", "gpt-5.6", fn);
    const out: string[] = [];
    for await (const c of p.stream({ system: "s", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yes" }], effort: "low" })) out.push(c);
    expect(out.join("")).toBe("Good evening.");
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.input).toEqual([{ role: "user", content: "hi" }, { role: "assistant", content: "yes" }]);
  });

  it("images: returns a PNG data URL", async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ created: 1, data: [{ b64_json: "iVBOR" }] }));
    const url = await new OpenAIImages("k", "gpt-image-2", fn).generate("a train", "wide");
    expect(url).toBe("data:image/png;base64,iVBOR");
    expect(calls[0].body).toMatchObject({ model: "gpt-image-2", size: "1536x1024" });
  });
});

describe("Gemini", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("json: responseJsonSchema + thinking level", async () => {
    const { fn, calls } = fakeFetch(() =>
      Response.json({ candidates: [{ content: { role: "model", parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] }),
    );
    vi.stubGlobal("fetch", fn);
    const p = new GeminiProvider("AIza-test", "gemini-3-flash-preview");
    await expect(p.json({ system: "sys", prompt: "hi", schemaName: "x", schema, effort: "high" })).resolves.toEqual({ ok: true });
    const { url, body, headers } = calls[0];
    expect(url).toContain("models/gemini-3-flash-preview:generateContent");
    expect(headers.get("x-goog-api-key")).toBe("AIza-test");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(schema);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("stream: maps assistant turns to the model role", async () => {
    const { fn, calls } = fakeFetch(() =>
      sse([
        [null, { candidates: [{ content: { role: "model", parts: [{ text: "Nothing " }] } }] }],
        [null, { candidates: [{ content: { role: "model", parts: [{ text: "to add." }] }, finishReason: "STOP" }] }],
      ]),
    );
    vi.stubGlobal("fetch", fn);
    const p = new GeminiProvider("k", "gemini-3-flash-preview");
    const out: string[] = [];
    for await (const c of p.stream({ system: "s", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], effort: "low" })) out.push(c);
    expect(out.join("")).toBe("Nothing to add.");
    expect(calls[0].url).toContain(":streamGenerateContent");
    expect(calls[0].body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("images: returns inline image data", async () => {
    const { fn, calls } = fakeFetch(() =>
      Response.json({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] }, finishReason: "STOP" }] }),
    );
    vi.stubGlobal("fetch", fn);
    const url = await new GeminiImages("k", "gemini-3.1-flash-image").generate("portrait", "square");
    expect(url).toBe("data:image/png;base64,QUJD");
    expect(calls[0].body.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(calls[0].body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1" });
  });
});
