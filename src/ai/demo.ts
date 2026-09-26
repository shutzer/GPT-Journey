import { DEMO_CASE } from "./demoCase";
import type { ChatMessage, ImageProvider, JsonRequest, StreamRequest, TextProvider } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Offline stand-in for a real model: always serves the same hand-written case and answers
 * interrogations with simple rules. Lets anyone try the game (and the tests run) without a key.
 */
export class DemoProvider implements TextProvider {
  readonly label = "Demo (offline)";

  constructor(private delay = 15) {}

  async json(req: JsonRequest): Promise<unknown> {
    await sleep(this.delay * 10);
    switch (req.schemaName) {
      case "premise": {
        const c = structuredClone(DEMO_CASE);
        return {
          title: c.title,
          setting: c.setting,
          art_style: c.art_style,
          briefing: c.briefing,
          cover_prompt: c.cover_prompt,
          victim: c.victim,
          cast: c.suspects.map((s) => ({ name: s.name, role: s.role })),
        };
      }
      case "case_file": {
        const text = JSON.stringify(DEMO_CASE);
        for (let i = 1; i <= 4; i++) {
          await sleep(this.delay * 5);
          req.onProgress?.(Math.round((text.length * i) / 4));
        }
        return structuredClone(DEMO_CASE);
      }
      case "audit":
        return { solvable: true, issues: [] };
      case "motive_grade": {
        const said = req.prompt.split("Detective's stated motive:")[1]?.toLowerCase() ?? "";
        const hits = ["brother", "adria", "ship", "revenge", "brat", "osvet", "brod"].filter((w) => said.includes(w)).length;
        return { score: Math.min(2, hits), comment: hits ? "You understood why he did it." : "The real motive escaped you." };
      }
      default:
        throw new Error(`Demo provider has no answer for ${req.schemaName}`);
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<string> {
    const reply = req.system.startsWith("You are the detective's") ? watson() : suspectReply(req.system, req.messages);
    for (const word of reply.split(/(?<= )/)) {
      await sleep(this.delay);
      yield word;
    }
  }
}

function suspectReply(system: string, messages: ChatMessage[]): string {
  const suspect = DEMO_CASE.suspects.find((s) => system.startsWith(`You are ${s.name},`));
  if (!suspect) return "...";
  const last = messages.at(-1)?.content ?? "";
  // Objection: the prompt carries the admission to make.
  const admission = last.match(/make this admission in your own words: "([^]*)"\)$/)?.[1];
  if (last.includes("OBJECTION!") && admission) return `*${suspect.name.split(" ").at(-1)} is silent for a moment.* ${admission}`;
  if (last.includes("*The detective lays evidence on the table:*")) return "I don't see what that proves, Detective.";
  const q = last.toLowerCase();
  const says = (i: number) => suspect.statements[i % suspect.statements.length].text;
  if (/where|alibi|gdje|bili|were you/.test(q)) return `As I told you: ${says(0)}`;
  if (/saw|see|notice|vidje|know|zna/.test(q)) return suspect.knowledge.at(-1) ?? "I saw nothing.";
  if (/horvat|victim|him|žrtv|njega/.test(q)) return `${suspect.relationship_to_victim}. That's all there is to say.`;
  return says(1);
}

function watson(): string {
  return "Everyone here is hiding something, but not everything they hide is murder. The poison was in the decanter, so the killer only had to reach it before midnight. Whoever claims they never left their room while someone saw them in the corridor is our weak point: find what the secretary was really doing, and see what she saw.";
}

/** Procedural placeholder art so the demo still looks like a case board. */
export class DemoImages implements ImageProvider {
  async generate(prompt: string, shape: "square" | "wide"): Promise<string> {
    let h = 0;
    for (const ch of prompt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = h % 360;
    const [w, hgt] = shape === "wide" ? [1024, 576] : [512, 512];
    const body =
      shape === "wide"
        ? `<rect y="${hgt * 0.62}" width="${w}" height="${hgt}" fill="hsl(${hue},25%,14%)"/><rect x="${w * 0.12}" y="${hgt * 0.42}" width="${w * 0.76}" height="${hgt * 0.22}" rx="18" fill="hsl(${hue},20%,10%)"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${w * 0.15 + i * w * 0.09}" y="${hgt * 0.46}" width="${w * 0.06}" height="${hgt * 0.08}" rx="4" fill="${i === 2 ? "#f3c77a" : `hsl(${hue},25%,22%)`}"/>`).join("")}`
        : `<circle cx="256" cy="210" r="92" fill="hsl(${hue},18%,12%)"/><path d="M96 512c10-120 80-180 160-180s150 60 160 180z" fill="hsl(${hue},18%,12%)"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}"><defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="hsl(${(hue + 30) % 360},45%,42%)"/><stop offset="1" stop-color="hsl(${hue},40%,9%)"/></radialGradient></defs><rect width="${w}" height="${hgt}" fill="url(#g)"/>${body}</svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
}
