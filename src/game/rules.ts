import type { CaseEvent, CaseFile, Clue, MotiveGrade, Statement } from "./schema";
import type { Accusation, CaseRecord, Mode, Verdict } from "./state";

export const COST = {
  search: 3,
  question: 1,
  objection: 1,
  /** Extra time lost on a wrong objection. */
  objectionMiss: 2,
  watson: 2,
} as const;

export const MAX_STRIKES = 3;

export const MODES: Record<Mode, { suspects: number; locations: number; statements: string; events: string; hoursPerSuspect: number }> = {
  quick: { suspects: 3, locations: 3, statements: "2", events: "1-2", hoursPerSuspect: 8 },
  standard: { suspects: 4, locations: 4, statements: "2-3", events: "2-3", hoursPerSuspect: 11 },
  hard: { suspects: 5, locations: 5, statements: "3", events: "3-4", hoursPerSuspect: 11 },
};

export function timeBudget(mode: Mode, suspects: number): number {
  return suspects * MODES[mode].hoursPerSuspect;
}

export const truthId = (lieId: string) => `${lieId}_truth`;

export function allStatements(file: CaseFile): Statement[] {
  return file.suspects.flatMap((s) => s.statements);
}

export function ownerOf(file: CaseFile, statementId: string) {
  const base = statementId.replace(/_truth$/, "");
  return file.suspects.find((s) => s.statements.some((st) => st.id === base));
}

/**
 * Replays the whole investigation with perfect play: every clue that cannot be destroyed is
 * found, every statement is heard, and any lie whose contradicting evidence is in hand gets
 * exposed, which in turn yields its admission as new evidence. Returns the lies that can never
 * be exposed.
 */
export function unprovableLies(file: CaseFile): Statement[] {
  const destroyed = new Set(file.events.filter((e) => e.effect === "destroy_clue").map((e) => e.target));
  const have = new Set<string>([
    ...file.clues.filter((c) => !destroyed.has(c.id)).map((c) => c.id),
    ...allStatements(file).map((s) => s.id),
  ]);
  const lies = allStatements(file).filter((s) => s.lie);
  const exposed = new Set<string>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const lie of lies) {
      if (!exposed.has(lie.id) && lie.contradicted_by.some((id) => have.has(id))) {
        exposed.add(lie.id);
        have.add(truthId(lie.id));
        progress = true;
      }
    }
  }
  return lies.filter((l) => !exposed.has(l.id));
}

/** Cross-reference and solvability checks the JSON schema cannot express. Returns problems to repair. */
export function validateCase(file: CaseFile, mode: Mode = "standard", expectedSuspects?: number): string[] {
  const problems: string[] = [];
  const suspectIds = new Set(file.suspects.map((s) => s.id));
  const locationIds = new Set(file.locations.map((l) => l.id));
  const statements = allStatements(file);
  const evidenceIds = new Set([
    ...file.clues.map((c) => c.id),
    ...statements.map((s) => s.id),
    ...statements.filter((s) => s.lie).map((s) => truthId(s.id)),
  ]);

  const dupes = (ids: string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  for (const [what, ids] of [
    ["suspect", file.suspects.map((s) => s.id)],
    ["location", file.locations.map((l) => l.id)],
    ["clue", file.clues.map((c) => c.id)],
    ["statement", statements.map((s) => s.id)],
  ] as const) {
    for (const id of dupes([...ids])) problems.push(`Duplicate ${what} id "${id}".`);
  }

  if (file.suspects.length < 3 || file.suspects.length > 6) problems.push("There must be 3-6 suspects.");
  if (expectedSuspects && file.suspects.length !== expectedSuspects)
    problems.push(`There must be exactly ${expectedSuspects} suspects.`);
  if (file.locations.length < MODES[mode].locations) problems.push(`There must be at least ${MODES[mode].locations} locations.`);
  if (!suspectIds.has(file.solution.culprit_id)) problems.push("solution.culprit_id is not a suspect id.");

  for (const clue of file.clues) {
    if (!locationIds.has(clue.location_id)) problems.push(`Clue "${clue.id}" is in unknown location "${clue.location_id}".`);
    if (clue.points_to !== "none" && !suspectIds.has(clue.points_to))
      problems.push(`Clue "${clue.id}" points to unknown suspect "${clue.points_to}".`);
  }
  for (const loc of file.locations) {
    if (!file.clues.some((c) => c.location_id === loc.id)) problems.push(`Location "${loc.id}" has no clues.`);
  }

  const key = file.solution.key_clue_ids;
  if (key.length < 3) problems.push("solution.key_clue_ids must list at least 3 clues.");
  for (const id of key) {
    const clue = file.clues.find((c) => c.id === id);
    if (!clue) problems.push(`Key clue "${id}" does not exist.`);
    else if (clue.red_herring) problems.push(`Key clue "${id}" is marked as a red herring.`);
  }
  if (!file.clues.some((c) => c.red_herring)) problems.push("Include at least one red herring.");

  for (const s of file.suspects) {
    const lies = s.statements.filter((st) => st.lie).length;
    if (s.statements.length < 2) problems.push(`Suspect "${s.id}" needs at least 2 statements.`);
    if (!lies) problems.push(`Suspect "${s.id}" needs at least one lie among their statements.`);
    if (s.id === file.solution.culprit_id && lies < 2) problems.push(`The culprit "${s.id}" needs at least 2 lies.`);
    if (s.id !== file.solution.culprit_id && !file.clues.some((c) => c.points_to === s.id))
      problems.push(`Innocent suspect "${s.id}" has no clue pointing at them; add a misleading one.`);
  }
  for (const st of statements) {
    if (st.lie) {
      if (!st.contradicted_by.length) problems.push(`Lie "${st.id}" has nothing in contradicted_by.`);
      if (!st.admission.trim()) problems.push(`Lie "${st.id}" has no admission.`);
      for (const ref of st.contradicted_by) {
        if (!evidenceIds.has(ref)) problems.push(`Lie "${st.id}" is contradicted by unknown id "${ref}".`);
        if (ref === st.id || ref === truthId(st.id)) problems.push(`Lie "${st.id}" cannot contradict itself.`);
      }
    } else if (st.contradicted_by.length) {
      problems.push(`True statement "${st.id}" must have an empty contradicted_by.`);
    }
  }
  if (!problems.length) {
    for (const lie of unprovableLies(file))
      problems.push(`Lie "${lie.id}" can never be exposed: none of its contradicting evidence is obtainable.`);
  }
  return problems;
}

/**
 * Drops events that would be unfair or reference nothing. Events are flavour and pressure; a
 * broken one is removed rather than sent back for repair.
 */
export function pruneEvents(file: CaseFile, total: number): CaseFile {
  const clueIds = new Set(file.clues.map((c) => c.id));
  const suspectIds = new Set(file.suspects.map((s) => s.id));
  const key = new Set(file.solution.key_clue_ids);
  const events: CaseEvent[] = [];
  for (const e of file.events) {
    if (!(e.at_hour >= 1 && e.at_hour <= total - 2)) continue;
    if ((e.effect === "reveal_clue" || e.effect === "destroy_clue") && !clueIds.has(e.target)) continue;
    if (e.effect === "destroy_clue" && key.has(e.target)) continue;
    if (e.effect === "silence" && !suspectIds.has(e.target)) continue;
    if (events.some((x) => x.target === e.target && x.effect !== "none" && e.effect !== "none")) continue;
    // A destroyed clue must not be the only way to expose a lie.
    if (e.effect === "destroy_clue" && unprovableLies({ ...file, events: [...events, e] }).length) continue;
    events.push({ ...e, at_hour: Math.round(e.at_hour) });
  }
  return { ...file, events: events.sort((a, b) => a.at_hour - b.at_hour) };
}

export const elapsed = (r: CaseRecord) => r.timeTotal - r.time;

function firedEffects(r: CaseRecord, effect: CaseEvent["effect"]): Set<string> {
  return new Set(r.fired.map((i) => r.file.events[i]).filter((e) => e?.effect === effect).map((e) => e.target));
}

/** Clues a reveal event has not produced yet are not there to be found. */
export function isHidden(r: CaseRecord, clueId: string): boolean {
  return r.file.events.some((e, i) => e.effect === "reveal_clue" && e.target === clueId && !r.fired.includes(i));
}

export function isDestroyed(r: CaseRecord, clueId: string): boolean {
  return firedEffects(r, "destroy_clue").has(clueId) && !r.found.includes(clueId);
}

export function isSilenced(r: CaseRecord, suspectId: string): boolean {
  return firedEffects(r, "silence").has(suspectId);
}

export function cluesAt(file: CaseFile, locationId: string): Clue[] {
  return file.clues.filter((c) => c.location_id === locationId);
}

/** The next clue that can still be found in a location, or null when there is nothing left. */
export function nextClue(r: CaseRecord, locationId: string): Clue | null {
  return cluesAt(r.file, locationId).find((c) => !r.found.includes(c.id) && !isHidden(r, c.id) && !isDestroyed(r, c.id)) ?? null;
}

export interface EvidenceItem {
  id: string;
  kind: "clue" | "statement" | "truth";
  title: string;
  text: string;
  suspectId?: string;
}

/** Everything the detective can currently lay on the table. */
export function evidence(r: CaseRecord): EvidenceItem[] {
  const items: EvidenceItem[] = r.found.flatMap((id) => {
    const c = r.file.clues.find((x) => x.id === id);
    return c ? [{ id, kind: "clue" as const, title: c.title, text: c.description }] : [];
  });
  for (const s of r.file.suspects) {
    if (!r.interviewed.includes(s.id)) continue;
    for (const st of s.statements) {
      items.push({ id: st.id, kind: "statement", title: s.name, text: st.text, suspectId: s.id });
      if (r.exposed.includes(st.id))
        items.push({ id: truthId(st.id), kind: "truth", title: s.name, text: st.admission, suspectId: s.id });
    }
  }
  return items;
}

export function canAct(r: CaseRecord, cost: number): boolean {
  return !r.verdict && r.strikes < MAX_STRIKES && r.time >= cost;
}

export function offCase(r: CaseRecord): boolean {
  return r.strikes >= MAX_STRIKES || r.time <= 0;
}

export function composure(r: CaseRecord, suspectId: string): number {
  const lies = r.file.suspects.find((s) => s.id === suspectId)?.statements.filter((st) => st.lie) ?? [];
  if (!lies.length) return 1;
  return 1 - lies.filter((l) => r.exposed.includes(l.id)).length / lies.length;
}

export function confessed(r: CaseRecord): boolean {
  return composure(r, r.file.solution.culprit_id) === 0;
}

/** Does this evidence prove this statement false? */
export function objectionHolds(file: CaseFile, statementId: string, evidenceId: string): boolean {
  const st = allStatements(file).find((s) => s.id === statementId);
  return !!st?.lie && st.contradicted_by.includes(evidenceId);
}

export function score(r: CaseRecord, accusation: Accusation, motive: MotiveGrade): Verdict {
  const { solution } = r.file;
  const correct = accusation.culpritId === solution.culprit_id;
  const key = new Set(solution.key_clue_ids);
  const keyFound = r.found.filter((id) => key.has(id)).length;
  const keyCited = accusation.evidence.filter((id) => key.has(id)).length;
  const liesTotal = allStatements(r.file).filter((s) => s.lie).length;
  const liesExposed = r.exposed.length;
  const motivePoints = Math.max(0, Math.min(2, Math.round(motive.score)));
  const didConfess = confessed(r);
  const exposure = liesTotal ? liesExposed / liesTotal : 0;

  let points: number;
  if (correct) {
    points =
      40 +
      20 * exposure +
      15 * (keyCited / Math.max(1, key.size)) +
      7.5 * motivePoints +
      5 * (r.time / r.timeTotal) +
      (didConfess ? 5 : 0) -
      5 * r.strikes;
  } else {
    points = 10 * exposure;
  }
  points = Math.max(0, Math.min(100, Math.round(points)));
  return {
    correct,
    score: points,
    rank: rankFor(points, correct),
    motive,
    keyFound,
    keyTotal: key.size,
    keyCited,
    liesExposed,
    liesTotal,
    strikes: r.strikes,
    confessed: didConfess,
  };
}

function rankFor(points: number, correct: boolean): string {
  if (!correct) return "rank.wrong";
  if (points >= 90) return "rank.legend";
  if (points >= 75) return "rank.inspector";
  if (points >= 60) return "rank.sergeant";
  return "rank.lucky";
}
