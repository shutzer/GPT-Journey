import { AIError, RESET, type ImageProvider, type TextProvider } from "../ai/types";
import {
  ARCHITECT_SYSTEM,
  AUDITOR_SYSTEM,
  JUDGE_SYSTEM,
  architectPrompt,
  auditPrompt,
  coverPrompt,
  judgePrompt,
  portraitPrompt,
  questionText,
  repairPrompt,
  suspectSystem,
  watsonPrompt,
  watsonSystem,
} from "./prompts";
import { COST, canAct, nextClue, score, timeBudget, validateCase } from "./rules";
import { Audit, CaseFile, MotiveGrade, jsonSchema, type Clue } from "./schema";
import type { Accusation, CaseRecord, CaseSetup, ChatTurn } from "./state";

export type BuildStep = "draft" | "repair" | "audit" | "done";

async function draft(
  text: TextProvider,
  prompt: string,
  signal?: AbortSignal,
  onProgress?: (chars: number) => void,
): Promise<{ file?: CaseFile; problems: string[] }> {
  const raw = await text.json({
    system: ARCHITECT_SYSTEM,
    prompt,
    schemaName: "case_file",
    schema: jsonSchema(CaseFile),
    // "high" makes reasoning models think for minutes before writing; medium plus the audit is enough.
    effort: "medium",
    signal,
    onProgress,
  });
  const parsed = CaseFile.safeParse(raw);
  if (!parsed.success) return { problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { file: parsed.data, problems: [] };
}

/**
 * Writes a case, checks it mechanically (rules.ts) and with an independent auditor pass,
 * and sends it back for repair when either finds problems.
 */
export async function buildCase(
  text: TextProvider,
  setup: CaseSetup,
  onStep: (step: BuildStep) => void = () => {},
  signal?: AbortSignal,
  onProgress?: (chars: number) => void,
): Promise<CaseFile> {
  onStep("draft");
  let { file, problems } = await draft(text, architectPrompt(setup), signal, onProgress);
  if (file) problems = validateCase(file, setup.suspects);

  for (let attempt = 0; problems.length && attempt < 2; attempt++) {
    onStep("repair");
    const prompt = file ? repairPrompt(setup, file, problems) : architectPrompt(setup);
    ({ file, problems } = await draft(text, prompt, signal, onProgress));
    if (file) problems = validateCase(file, setup.suspects);
  }
  if (!file || problems.length) throw new AIError("Couldn't produce a consistent case. Try again or pick another model.");

  onStep("audit");
  const audit = Audit.safeParse(
    await text.json({
      system: AUDITOR_SYSTEM,
      prompt: auditPrompt(file),
      schemaName: "audit",
      schema: jsonSchema(Audit),
      effort: "low",
      signal,
    }),
  );
  if (audit.success && !audit.data.solvable && audit.data.issues.length) {
    onStep("repair");
    const repaired = await draft(text, repairPrompt(setup, file, audit.data.issues), signal, onProgress);
    // Keep the repaired version only if it still passes the mechanical checks.
    if (repaired.file && !validateCase(repaired.file, setup.suspects).length) file = repaired.file;
  }
  onStep("done");
  return file;
}

export function newRecord(file: CaseFile, setup: CaseSetup, model: string): CaseRecord {
  const now = Date.now();
  const total = timeBudget(file.suspects.length);
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    setup,
    model,
    file,
    images: { portraits: {} },
    time: total,
    timeTotal: total,
    found: [],
    talks: {},
    pins: [],
    watson: [],
  };
}

function touch(record: CaseRecord, patch: Partial<CaseRecord>): CaseRecord {
  return { ...record, ...patch, updatedAt: Date.now() };
}

export function search(record: CaseRecord, locationId: string): { record: CaseRecord; clue: Clue | null } {
  const clue = nextClue(record, locationId);
  if (!clue || !canAct(record, COST.search)) return { record, clue: null };
  return { record: touch(record, { found: [...record.found, clue.id], time: record.time - COST.search }), clue };
}

/**
 * Streams a suspect's answer. Yields the answer text so far after every chunk and resolves to the
 * updated record once the answer is complete. Nothing is committed if the stream fails.
 */
export async function* interrogate(
  text: TextProvider,
  record: CaseRecord,
  suspectId: string,
  question: string,
  evidenceIds: string[],
  signal?: AbortSignal,
): AsyncGenerator<string, CaseRecord> {
  const suspect = record.file.suspects.find((s) => s.id === suspectId);
  if (!suspect) throw new AIError("Unknown suspect.");
  if (!canAct(record, COST.question)) throw new AIError("You're out of time. Make your accusation.");
  const evidence = evidenceIds.flatMap((id) => record.file.clues.filter((c) => c.id === id && record.found.includes(id)));
  const history = record.talks[suspectId] ?? [];
  const messages = [
    // The opening statement is the suspect's first line; the detective's approach precedes it.
    { role: "user" as const, content: "*The detective approaches you.*" },
    { role: "assistant" as const, content: suspect.opening_statement },
    ...history.map((t) => ({
      role: t.role,
      content: t.role === "user" ? questionText(t.text, evidenceFor(record, t)) : t.text,
    })),
    { role: "user" as const, content: questionText(question, evidence) },
  ];

  let answer = "";
  for await (const chunk of text.stream({
    system: suspectSystem(record.file, suspect, record.setup.lang),
    messages,
    effort: "low",
    signal,
  })) {
    answer = chunk === RESET ? "" : answer + chunk;
    yield answer;
  }
  if (!answer.trim()) throw new AIError(`${suspect.name} says nothing. Try again.`);
  const turns: ChatTurn[] = [
    ...history,
    { role: "user", text: question, evidence: evidence.map((c) => c.id) },
    { role: "assistant", text: answer.trim() },
  ];
  return touch(record, { talks: { ...record.talks, [suspectId]: turns }, time: record.time - COST.question });
}

function evidenceFor(record: CaseRecord, turn: ChatTurn): Clue[] {
  return (turn.evidence ?? []).flatMap((id) => record.file.clues.filter((c) => c.id === id));
}

export async function* consultWatson(
  text: TextProvider,
  record: CaseRecord,
  signal?: AbortSignal,
): AsyncGenerator<string, CaseRecord> {
  if (!canAct(record, COST.watson)) throw new AIError("Not enough time left.");
  const found = record.found.flatMap((id) => record.file.clues.filter((c) => c.id === id));
  let note = "";
  for await (const chunk of text.stream({
    system: watsonSystem(record.setup.lang),
    messages: [{ role: "user", content: watsonPrompt(record.file, found, record.talks, record.pins) }],
    effort: "medium",
    signal,
  })) {
    note = chunk === RESET ? "" : note + chunk;
    yield note;
  }
  return touch(record, { watson: [...record.watson, note.trim()], time: record.time - COST.watson });
}

export async function accuse(text: TextProvider, record: CaseRecord, accusation: Accusation, signal?: AbortSignal): Promise<CaseRecord> {
  let motive: MotiveGrade = { score: 0, comment: "" };
  if (accusation.motive.trim()) {
    const graded = MotiveGrade.safeParse(
      await text.json({
        system: JUDGE_SYSTEM,
        prompt: judgePrompt(record.file, accusation.motive, record.setup.lang),
        schemaName: "motive_grade",
        schema: jsonSchema(MotiveGrade),
        effort: "low",
        signal,
      }),
    );
    if (graded.success) motive = graded.data;
  }
  return touch(record, { accusation, verdict: score(record, accusation, motive) });
}

/**
 * Paints the cover and every portrait that is still missing, two at a time. Calls `onImage`
 * as each one lands so the UI can show and persist it immediately. Failures are skipped.
 */
export async function paint(
  images: ImageProvider,
  record: CaseRecord,
  onImage: (key: "cover" | string, dataUrl: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const jobs: Array<[string, string, "wide" | "square"]> = [];
  if (!record.images.cover) jobs.push(["cover", coverPrompt(record.file), "wide"]);
  for (const s of record.file.suspects) {
    if (!record.images.portraits[s.id]) jobs.push([s.id, portraitPrompt(record.file, s), "square"]);
  }
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      if (signal?.aborted) return;
      const [key, prompt, shape] = job;
      try {
        onImage(key, await images.generate(prompt, shape, signal));
      } catch (err) {
        console.warn(`image ${key} failed`, err);
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
