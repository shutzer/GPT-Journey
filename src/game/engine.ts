import { AIError, RESET, type ImageProvider, type TextProvider } from "../ai/types";
import {
  ARCHITECT_SYSTEM,
  AUDITOR_SYSTEM,
  JUDGE_SYSTEM,
  PREMISE_SYSTEM,
  architectPrompt,
  auditPrompt,
  coverPrompt,
  judgePrompt,
  objectionText,
  portraitPrompt,
  premisePrompt,
  questionText,
  repairPrompt,
  suspectSystem,
  watsonPrompt,
  watsonSystem,
} from "./prompts";
import {
  COST,
  MODES,
  canAct,
  elapsed,
  evidence,
  isSilenced,
  nextClue,
  objectionHolds,
  pruneEvents,
  score,
  timeBudget,
  validateCase,
} from "./rules";
import { Audit, CaseFile, MotiveGrade, Premise, jsonSchema, type CaseEvent, type Clue } from "./schema";
import type { Accusation, CaseRecord, CaseSetup, ChatTurn, Mode } from "./state";

export type BuildStep = "premise" | "draft" | "repair" | "audit" | "done";

export function newSetup(theme: string, lang: CaseSetup["lang"], mode: Mode, daily?: string): CaseSetup {
  return { theme, lang, mode, suspects: MODES[mode].suspects, ...(daily ? { daily } : {}) };
}

/** Fast first call: the opening the player reads while the full case is being built. */
export async function buildPremise(text: TextProvider, setup: CaseSetup, signal?: AbortSignal): Promise<Premise> {
  const parsed = Premise.safeParse(
    await text.json({
      system: PREMISE_SYSTEM,
      prompt: premisePrompt(setup),
      schemaName: "premise",
      schema: jsonSchema(Premise),
      effort: "low",
      signal,
    }),
  );
  if (!parsed.success) throw new AIError("The model returned an unusable case opening. Try again.");
  return parsed.data;
}

async function draft(
  text: TextProvider,
  prompt: string,
  setup: CaseSetup,
  premise: Premise,
  signal?: AbortSignal,
  onProgress?: (chars: number) => void,
): Promise<{ file?: CaseFile; problems: string[] }> {
  const raw = await text.json({
    system: ARCHITECT_SYSTEM,
    prompt,
    schemaName: "case_file",
    schema: jsonSchema(CaseFile),
    // "high" makes reasoning models think for minutes before writing; the checks below catch slips.
    effort: setup.mode === "quick" ? "low" : "medium",
    signal,
    onProgress,
  });
  const parsed = CaseFile.safeParse(raw);
  if (!parsed.success) return { problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  // The player has already read the opening: keep it verbatim.
  const file: CaseFile = {
    ...parsed.data,
    title: premise.title,
    setting: premise.setting,
    art_style: premise.art_style,
    briefing: premise.briefing,
    cover_prompt: premise.cover_prompt,
    victim: premise.victim,
  };
  return { file, problems: validateCase(file, setup.mode, setup.suspects) };
}

/**
 * Builds the full case on a premise, checks it mechanically (rules.ts, including a solvability
 * replay) and with an independent auditor pass, and sends it back for repair on failure.
 */
export async function buildCase(
  text: TextProvider,
  setup: CaseSetup,
  premise: Premise,
  onStep: (step: BuildStep) => void = () => {},
  signal?: AbortSignal,
  onProgress?: (chars: number) => void,
): Promise<CaseFile> {
  onStep("draft");
  let { file, problems } = await draft(text, architectPrompt(setup, premise), setup, premise, signal, onProgress);
  for (let attempt = 0; problems.length && attempt < 2; attempt++) {
    onStep("repair");
    const prompt = file ? repairPrompt(setup, premise, file, problems) : architectPrompt(setup, premise);
    ({ file, problems } = await draft(text, prompt, setup, premise, signal, onProgress));
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
    const repaired = await draft(text, repairPrompt(setup, premise, file, audit.data.issues), setup, premise, signal, onProgress);
    // Keep the repaired version only if it still passes the mechanical checks.
    if (repaired.file && !repaired.problems.length) file = repaired.file;
  }
  onStep("done");
  return pruneEvents(file, timeBudget(setup.mode, setup.suspects));
}

export function newRecord(file: CaseFile, setup: CaseSetup, model: string, cover?: string): CaseRecord {
  const now = Date.now();
  const total = timeBudget(setup.mode, file.suspects.length);
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    setup,
    model,
    file,
    images: { portraits: {}, ...(cover ? { cover } : {}) },
    time: total,
    timeTotal: total,
    found: [],
    interviewed: [],
    exposed: [],
    strikes: 0,
    fired: [],
    talks: {},
    watson: [],
    board: { pos: {}, strings: [] },
  };
}

/** Fills in fields added after a record was saved, so older cases keep working. */
export function migrate(r: CaseRecord): CaseRecord {
  return {
    ...r,
    setup: { ...r.setup, mode: r.setup.mode ?? "standard" },
    file: { ...r.file, events: r.file.events ?? [], suspects: r.file.suspects.map((s) => ({ ...s, statements: s.statements ?? [] })) },
    interviewed: r.interviewed ?? [],
    exposed: r.exposed ?? [],
    strikes: r.strikes ?? 0,
    fired: r.fired ?? [],
    board: r.board ?? { pos: {}, strings: [] },
  };
}

/** Spends time and fires every event whose hour has come. */
export function spend(record: CaseRecord, hours: number): { record: CaseRecord; events: CaseEvent[] } {
  const r: CaseRecord = { ...record, time: Math.max(0, record.time - hours), updatedAt: Date.now() };
  const due = r.file.events.map((e, i) => [e, i] as const).filter(([e, i]) => e.at_hour <= elapsed(r) && !r.fired.includes(i));
  r.fired = [...r.fired, ...due.map(([, i]) => i)];
  return { record: r, events: due.map(([e]) => e) };
}

export function search(record: CaseRecord, locationId: string): { record: CaseRecord; clue: Clue | null; events: CaseEvent[] } {
  const clue = nextClue(record, locationId);
  if (!clue || !canAct(record, COST.search)) return { record, clue: null, events: [] };
  const spent = spend({ ...record, found: [...record.found, clue.id] }, COST.search);
  return { ...spent, clue };
}

/** Taking a suspect's formal testimony is free: it's what makes their statements challengeable. */
export function interview(record: CaseRecord, suspectId: string): CaseRecord {
  if (record.interviewed.includes(suspectId)) return record;
  return { ...record, interviewed: [...record.interviewed, suspectId], updatedAt: Date.now() };
}

export interface ObjectionResult {
  record: CaseRecord;
  success: boolean;
  events: CaseEvent[];
}

export function object(record: CaseRecord, statementId: string, evidenceId: string): ObjectionResult {
  if (!canAct(record, COST.objection)) throw new AIError("You can't do that any more. Make your accusation.");
  if (record.exposed.includes(statementId)) throw new AIError("That lie is already exposed.");
  const available = new Set(evidence(record).map((e) => e.id));
  if (!available.has(statementId) || !available.has(evidenceId)) throw new AIError("You don't have that yet.");
  if (statementId === evidenceId) throw new AIError("A statement can't contradict itself.");
  const success = objectionHolds(record.file, statementId, evidenceId);
  const updated = success
    ? { ...record, exposed: [...record.exposed, statementId] }
    : { ...record, strikes: record.strikes + 1 };
  const spent = spend(updated, COST.objection + (success ? 0 : COST.objectionMiss));
  return { ...spent, success };
}

/** In-character reaction to a successful objection. Falls back to the scripted admission. */
export async function* react(
  text: TextProvider,
  record: CaseRecord,
  statementId: string,
  evidenceId: string,
  signal?: AbortSignal,
): AsyncGenerator<string, string> {
  const suspect = record.file.suspects.find((s) => s.statements.some((st) => st.id === statementId))!;
  const statement = suspect.statements.find((st) => st.id === statementId)!;
  const shown = evidence(record).find((e) => e.id === evidenceId) ?? { title: "", text: "" };
  let out = "";
  try {
    for await (const chunk of text.stream({
      // Pass the record *before* this exposure so the actor plays the moment of being caught.
      system: suspectSystem(record.file, suspect, record.setup.lang, record.exposed.filter((id) => id !== statementId)),
      messages: [{ role: "user", content: objectionText(statement, shown) }],
      effort: "low",
      signal,
    })) {
      out = chunk === RESET ? "" : out + chunk;
      yield out;
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("reaction failed", err);
  }
  return out.trim() || statement.admission;
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
): AsyncGenerator<string, { record: CaseRecord; events: CaseEvent[] }> {
  const suspect = record.file.suspects.find((s) => s.id === suspectId);
  if (!suspect) throw new AIError("Unknown suspect.");
  if (isSilenced(record, suspectId)) throw new AIError(`${suspect.name} refuses to answer any more questions.`);
  if (!canAct(record, COST.question)) throw new AIError("You can't do that any more. Make your accusation.");
  const available = evidence(record);
  const pick = (ids: string[]) => ids.flatMap((id) => available.filter((e) => e.id === id));
  const shown = pick(evidenceIds);
  const history = record.talks[suspectId] ?? [];
  const messages = [
    // The opening statement is the suspect's first line; the detective's approach precedes it.
    { role: "user" as const, content: "*The detective approaches you.*" },
    { role: "assistant" as const, content: suspect.opening_statement },
    ...history.map((t) => ({ role: t.role, content: t.role === "user" ? questionText(t.text, pick(t.evidence ?? [])) : t.text })),
    { role: "user" as const, content: questionText(question, shown) },
  ];

  let answer = "";
  for await (const chunk of text.stream({
    system: suspectSystem(record.file, suspect, record.setup.lang, record.exposed),
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
    { role: "user", text: question, evidence: shown.map((e) => e.id) },
    { role: "assistant", text: answer.trim() },
  ];
  return spend({ ...record, talks: { ...record.talks, [suspectId]: turns } }, COST.question);
}

export async function* consultWatson(
  text: TextProvider,
  record: CaseRecord,
  signal?: AbortSignal,
): AsyncGenerator<string, { record: CaseRecord; events: CaseEvent[] }> {
  if (!canAct(record, COST.watson)) throw new AIError("Not enough time left.");
  const found = record.found.flatMap((id) => record.file.clues.filter((c) => c.id === id));
  let note = "";
  for await (const chunk of text.stream({
    system: watsonSystem(record.setup.lang),
    messages: [{ role: "user", content: watsonPrompt(record.file, found, record.talks, record.interviewed, record.exposed) }],
    effort: "medium",
    signal,
  })) {
    note = chunk === RESET ? "" : note + chunk;
    yield note;
  }
  return spend({ ...record, watson: [...record.watson, note.trim()] }, COST.watson);
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
  return { ...record, accusation, verdict: score(record, accusation, motive), updatedAt: Date.now() };
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
