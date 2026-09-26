import { z } from "zod";

// These schemas double as the JSON Schemas sent to every provider's structured-output mode,
// so they stay inside the common subset: every field required, no numeric/length constraints,
// no optional properties. Semantic rules (counts, cross-references, solvability) live in rules.ts.

export const Clue = z.object({
  id: z.string().describe("Short slug, e.g. 'c1'"),
  title: z.string().describe("What the detective sees, 2-6 words"),
  description: z.string().describe("What the detective observes when finding it, 1-3 sentences. No conclusions."),
  location_id: z.string(),
  points_to: z.string().describe("Suspect id this clue implicates or exonerates, or 'none'"),
  significance: z.string().describe("Hidden: why this clue matters to the solution. Shown only at the reveal."),
  red_herring: z.boolean(),
});

export const Location = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().describe("Atmospheric description on arrival, 2-3 sentences"),
});

export const Statement = z.object({
  id: z.string().describe("Unique slug, e.g. 's1_a'"),
  text: z.string().describe("What the suspect claims, one or two sentences in their own voice"),
  lie: z.boolean(),
  contradicted_by: z
    .array(z.string())
    .describe(
      "For lies: ids of clues, other statements, or '<lie id>_truth' admissions that prove this false. Empty for true statements.",
    ),
  admission: z
    .string()
    .describe("For lies: what the suspect admits, in their voice, once caught. Must reveal a new useful fact. Empty for true statements."),
});

export const Suspect = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().describe("Occupation / place in this world, a few words"),
  appearance: z.string().describe("One vivid sentence"),
  personality: z.string(),
  speech_style: z.string().describe("How they talk: vocabulary, tics, rhythm"),
  relationship_to_victim: z.string(),
  opening_statement: z.string().describe("What they say when first approached, in character, 2-4 sentences"),
  statements: z.array(Statement).describe("Their formal testimony: claims the detective can challenge"),
  true_whereabouts: z.string().describe("Where they really were during the murder"),
  secret: z.string().describe("Something they hide. For innocents this must not be the murder but must look suspicious."),
  knowledge: z.array(z.string()).describe("True facts they know about others or the night, revealed if asked the right questions"),
  portrait_prompt: z.string().describe("Visual description for a head-and-shoulders portrait"),
});

export const CaseEvent = z.object({
  at_hour: z.number().describe("Hours after the investigation starts when this happens"),
  title: z.string().describe("Short headline"),
  text: z.string().describe("What the detective hears, 1-2 sentences"),
  effect: z.enum(["reveal_clue", "destroy_clue", "silence", "none"]),
  target: z.string().describe("Clue id for reveal_clue/destroy_clue, suspect id for silence, '' for none"),
});

export const Premise = z.object({
  title: z.string(),
  setting: z.string().describe("Era and place, one sentence"),
  art_style: z.string().describe("Shared illustration style for all images of this case"),
  briefing: z.string().describe("What the detective is told on arrival, 2-3 short paragraphs, second person"),
  cover_prompt: z.string().describe("Visual description of the scene for a wide illustration, no bodies shown graphically"),
  victim: z.object({
    name: z.string(),
    description: z.string(),
    cause_of_death: z.string(),
    found: z.string().describe("Where, when and by whom the body was found"),
  }),
  cast: z.array(z.object({ name: z.string(), role: z.string() })).describe("The suspects, in order"),
});

export const CaseFile = z.object({
  title: z.string(),
  setting: z.string(),
  art_style: z.string(),
  briefing: z.string(),
  cover_prompt: z.string(),
  victim: Premise.shape.victim,
  suspects: z.array(Suspect),
  locations: z.array(Location),
  clues: z.array(Clue),
  events: z.array(CaseEvent).describe("Things that happen while the detective investigates"),
  solution: z.object({
    culprit_id: z.string(),
    motive: z.string(),
    method: z.string(),
    opportunity: z.string(),
    key_clue_ids: z.array(z.string()).describe("The clues that together prove the culprit's guilt"),
    explanation: z.string().describe("The detective's closing reveal, 2-3 paragraphs"),
  }),
  timeline: z.array(z.object({ time: z.string(), event: z.string() })),
});

export const Audit = z.object({
  solvable: z.boolean(),
  issues: z.array(z.string()).describe("Contradictions, missing links or ways another suspect fits equally well"),
});

export const MotiveGrade = z.object({
  score: z.number().describe("0 = wrong, 1 = partly right, 2 = essentially right"),
  comment: z.string().describe("One sentence, addressed to the detective"),
});

export type Clue = z.infer<typeof Clue>;
export type Location = z.infer<typeof Location>;
export type Statement = z.infer<typeof Statement>;
export type Suspect = z.infer<typeof Suspect>;
export type CaseEvent = z.infer<typeof CaseEvent>;
export type Premise = z.infer<typeof Premise>;
export type CaseFile = z.infer<typeof CaseFile>;
export type Audit = z.infer<typeof Audit>;
export type MotiveGrade = z.infer<typeof MotiveGrade>;

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}
