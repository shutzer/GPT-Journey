import type { CaseFile, Clue, MotiveGrade } from "./schema";
import type { Accusation, CaseRecord, Verdict } from "./state";

export const COST = {
  search: 3,
  question: 1,
  watson: 2,
} as const;

export const TIME_PER_SUSPECT = 12;

export function timeBudget(suspects: number): number {
  return suspects * TIME_PER_SUSPECT;
}

/** Cross-reference checks the JSON schema cannot express. Returns human-readable problems. */
export function validateCase(file: CaseFile, expectedSuspects?: number): string[] {
  const problems: string[] = [];
  const suspectIds = new Set(file.suspects.map((s) => s.id));
  const locationIds = new Set(file.locations.map((l) => l.id));
  const clueIds = new Set(file.clues.map((c) => c.id));

  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const [what, ids] of [
    ["suspect", file.suspects.map((s) => s.id)],
    ["location", file.locations.map((l) => l.id)],
    ["clue", file.clues.map((c) => c.id)],
  ] as const) {
    for (const id of dupes([...ids])) problems.push(`Duplicate ${what} id "${id}".`);
  }

  if (file.suspects.length < 3 || file.suspects.length > 6) problems.push("There must be 3-6 suspects.");
  if (expectedSuspects && file.suspects.length !== expectedSuspects)
    problems.push(`There must be exactly ${expectedSuspects} suspects.`);
  if (file.locations.length < 3) problems.push("There must be at least 3 locations.");
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
    if (s.id !== file.solution.culprit_id && !file.clues.some((c) => c.points_to === s.id))
      problems.push(`Innocent suspect "${s.id}" has no clue pointing at them; add a misleading one.`);
  }
  if (!clueIds.size) problems.push("No clues.");
  return problems;
}

export function cluesAt(file: CaseFile, locationId: string): Clue[] {
  return file.clues.filter((c) => c.location_id === locationId);
}

/** The next undiscovered clue in a location, or null when it has been searched clean. */
export function nextClue(record: CaseRecord, locationId: string): Clue | null {
  return cluesAt(record.file, locationId).find((c) => !record.found.includes(c.id)) ?? null;
}

export function canAct(record: CaseRecord, cost: number): boolean {
  return !record.verdict && record.time >= cost;
}

export function score(
  record: CaseRecord,
  accusation: Accusation,
  motive: MotiveGrade,
): Verdict {
  const { solution } = record.file;
  const correct = accusation.culpritId === solution.culprit_id;
  const key = new Set(solution.key_clue_ids);
  const keyFound = record.found.filter((id) => key.has(id)).length;
  const keyCited = accusation.evidence.filter((id) => key.has(id)).length;
  const motivePoints = Math.max(0, Math.min(2, Math.round(motive.score)));

  let points = 0;
  if (correct) {
    points += 50;
    points += Math.round((keyCited / key.size) * 30);
    points += motivePoints * 7.5;
    points += Math.round((record.time / record.timeTotal) * 5);
  } else {
    points += Math.round((keyFound / key.size) * 10);
  }
  points = Math.min(100, Math.round(points));
  return { correct, score: points, rank: rankFor(points, correct), motive, keyFound, keyTotal: key.size, keyCited };
}

function rankFor(points: number, correct: boolean): string {
  if (!correct) return "rank.wrong";
  if (points >= 90) return "rank.legend";
  if (points >= 75) return "rank.inspector";
  if (points >= 60) return "rank.sergeant";
  return "rank.lucky";
}
