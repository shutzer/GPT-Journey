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
      case "case_file":
        return structuredClone(DEMO_CASE);
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
  const q = last.toLowerCase();
  const shown = DEMO_CASE.clues.filter((c) => last.includes(`[${c.title}:`)).map((c) => c.id);
  const cracks = [...suspect.breaking_point.matchAll(/\b(c\d+)\b/g)].map((m) => m[1]);

  if (suspect.id === "s2") {
    const hard = shown.includes("c3") && (shown.includes("c2") || shown.includes("c7"));
    if (hard) return "*He takes off his spectacles and is quiet for a long time.* Ivan was thirty-one. Horvat knew that ship would not survive a winter sea. Yes, Detective. I put it in his brandy.";
    if (shown.length) return "*He studies it politely.* A curious object. I'm afraid I can't see how it concerns me.";
  } else if (shown.some((id) => cracks.includes(id))) {
    return CONFESSIONS[suspect.id] ?? "...";
  } else if (shown.length) {
    return "I don't see what that has to do with me.";
  }
  if (/where|alibi|gdje|bili|were you/.test(q)) return `As I said: ${suspect.claimed_alibi.charAt(0).toLowerCase()}${suspect.claimed_alibi.slice(1)}`;
  if (/saw|see|notice|vidje|know|zna/.test(q)) return suspect.knowledge.at(-1) ?? "I saw nothing.";
  if (/horvat|victim|him|žrtv|njega/.test(q)) return `${suspect.relationship_to_victim}. That's all there is to say.`;
  return suspect.lies[0] ?? "I have nothing more to say.";
}

const CONFESSIONS: Record<string, string> = {
  s1: "*She sets the bill down very carefully.* Very well. I met a man from Lloyd Triestino; I am leaving Horvat's employ, and I was giving them his contracts. That is a betrayal, not a murder. And since we are being honest: at a quarter to twelve I saw Dr Marić coming back along the corridor from compartment 3, with his black bag.",
  s3: "*She snatches the glove.* Fine! I was in the corridor, on my way to Tomo. Yes, Tomo. But Viktor was alive, I heard him humming behind the door at five to twelve. Humming! As if nothing in the world could touch him.",
  s4: "*He rubs his moustache.* All right, sir, the cigarettes are mine, a man has to live. And I was in the van with Mrs Horvat, God forgive me. But I'll tell you who I did see at compartment 3 before midnight: the doctor, at about twenty to.",
};

function watson(): string {
  return "Everyone we've spoken to is hiding something, but not everything they hide is murder. The poison was in the decanter, so the killer only had to reach it before midnight. I'd ask each of them who they saw near compartment 3, and I'd take a close look at what the doctor keeps in his specimen case.";
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
