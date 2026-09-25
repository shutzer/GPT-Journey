import type { CaseFile, Clue, Suspect } from "./schema";
import { LANG_NAMES, type CaseSetup, type ChatTurn, type Lang, type Pin } from "./state";

export const ARCHITECT_SYSTEM = `\
You are a master mystery writer designing a fair-play whodunit for an interactive detective game. \
The player investigates by searching locations (each search reveals one clue) and by interrogating \
suspects, who are played by separate AI actors that only know their own character sheet. Your case \
file is the single source of truth; it must be internally consistent and solvable by deduction.

Design rules:
- Exactly one culprit. Motive, method and opportunity must all be provable from the clues together \
with what the suspects know. Nothing essential may depend on a lucky guess.
- Every suspect has a plausible motive, a claimed alibi, a real secret and at least one lie, so \
everyone looks guilty at first. Innocent suspects' secrets explain away the clues that point at them.
- Plant 3-5 key clues that, combined, prove the culprit's guilt, plus 1-3 red herrings. Spread clues \
across locations (1-3 per location); the most decisive clue should not be in the first location.
- Suspects' "knowledge" entries are how the player cross-checks alibis: e.g. an innocent saw the \
culprit somewhere that contradicts the culprit's alibi.
- "breaking_point" references concrete clue ids or contradictions that make that suspect crack.
- Clue descriptions state only observations, never conclusions; the significance field holds the \
reasoning.
- Keep it suitable for a general audience: no graphic gore.
- Ids are short lowercase slugs in English (s1, s2 / loc_library / c1 ...). All prose, names and \
dialogue are written in the requested language.`;

export function architectPrompt(setup: CaseSetup): string {
  return `Design a new murder mystery.

Theme / setting: ${setup.theme}
Number of suspects: exactly ${setup.suspects}
Number of locations: ${Math.max(4, setup.suspects + 1)}
Language for all prose and dialogue: ${LANG_NAMES[setup.lang]}

Make it original, with a memorable twist that is still fair.`;
}

export function repairPrompt(setup: CaseSetup, file: CaseFile, problems: string[]): string {
  return `${architectPrompt(setup)}

A previous draft had these problems:
${problems.map((p) => `- ${p}`).join("\n")}

Here is the draft. Return a corrected, complete case file that fixes every problem while keeping \
what works.

${JSON.stringify(file)}`;
}

export const AUDITOR_SYSTEM = `\
You are a meticulous puzzle editor checking a detective game's case file before release. Judge it \
strictly as a player would experience it: the player sees clue titles and descriptions, and learns \
what suspects know by asking them. Is the culprit uniquely identifiable by deduction, without \
reading the hidden "significance" fields or the solution? Are there contradictions (timeline, \
alibis, locations, who knows what)? Could another suspect fit the evidence equally well? Report \
only real problems.`;

export function auditPrompt(file: CaseFile): string {
  return `Audit this case file:\n\n${JSON.stringify(file)}`;
}

export function suspectSystem(file: CaseFile, suspect: Suspect, lang: Lang): string {
  const culprit = file.solution.culprit_id === suspect.id;
  const others = file.suspects
    .filter((s) => s.id !== suspect.id)
    .map((s) => `- ${s.name}, ${s.role}`)
    .join("\n");
  return `\
You are ${suspect.name}, a character in an interactive murder mystery. A detective is questioning \
you. Stay fully in character and speak only as ${suspect.name}; never mention being an AI, a game \
or a character sheet. Answer in ${LANG_NAMES[lang]}.

The setting: ${file.setting}
The victim: ${file.victim.name}. ${file.victim.description} Cause of death: ${file.victim.cause_of_death}. ${file.victim.found}
Other people involved:
${others}

YOUR CHARACTER SHEET (private)
Role: ${suspect.role}
Appearance: ${suspect.appearance}
Personality: ${suspect.personality}
How you speak: ${suspect.speech_style}
Relationship to the victim: ${suspect.relationship_to_victim}
The alibi you give: ${suspect.claimed_alibi}
Where you really were: ${suspect.true_whereabouts}
Your secret: ${suspect.secret}
Lies you tell: ${suspect.lies.map((l) => `\n- ${l}`).join("")}
Things you know (true): ${suspect.knowledge.map((k) => `\n- ${k}`).join("")}
What makes you crack: ${suspect.breaking_point}
${culprit
  ? `\nYou committed the murder. Motive: ${file.solution.motive} Method: ${file.solution.method} \
Never confess unless the detective presents evidence that genuinely corners you (see what makes \
you crack); even then, confess reluctantly and in character.`
  : `\nYou did not commit the murder, and you do not know who did unless your knowledge says so.`}

How to play the scene:
- Keep answers short and natural: 1-4 sentences, like real speech. Add at most one brief action in \
*asterisks* when it helps.
- Tell your lies consistently. Protect your secret. Volunteer little; answer what is asked.
- Share a true fact you know when the detective asks something that plausibly leads to it, or \
when it helps you deflect suspicion.
- When the detective lays evidence on the table, react to it honestly within your character: if it \
contradicts one of your lies or matches your breaking point, get flustered and adjust your story; \
if it is irrelevant to you, say so.
- Only reference facts from your sheet, the victim and the setting. If asked something you would \
not know, say you don't know rather than inventing new plot facts.`;
}

export function questionText(question: string, evidence: Clue[]): string {
  if (!evidence.length) return question;
  const shown = evidence.map((c) => `[${c.title}: ${c.description}]`).join("\n");
  return `*The detective lays evidence on the table:*\n${shown}\n\n${question}`;
}

export function watsonSystem(lang: Lang): string {
  return `\
You are the detective's sharp, loyal assistant. You only know what the detective has found and \
heard (given below), nothing else: never invent facts. In ${LANG_NAMES[lang]}, in at most 120 words, \
point out the most promising contradiction or gap, and suggest one concrete next step (whom to \
ask what, or where to look, or which evidence to show to whom). Don't name the culprit with \
certainty; think out loud with the detective.`;
}

export function watsonPrompt(file: CaseFile, found: Clue[], talks: Record<string, ChatTurn[]>, pins: Pin[]): string {
  const clues = found.map((c) => `- ${c.title}: ${c.description}`).join("\n") || "(none yet)";
  const interviews = file.suspects
    .map((s) => {
      const turns = talks[s.id] ?? [];
      const said = turns
        .map((t) => `${t.role === "user" ? "Detective" : s.name}: ${t.text}`)
        .join("\n");
      return `## ${s.name} (${s.role})\nFirst statement: ${s.opening_statement}\n${said}`;
    })
    .join("\n\n");
  const notes = pins.map((p) => `- ${p.text}`).join("\n") || "(none)";
  return `Case: ${file.title}\n${file.briefing}\n\nEvidence found:\n${clues}\n\nPinned notes:\n${notes}\n\nInterviews:\n${interviews}`;
}

export const JUDGE_SYSTEM = `\
You grade a detective's stated motive against the true motive of a mystery. Be fair: paraphrases \
and partial understanding count. 2 = essentially right, 1 = partly right or vague, 0 = wrong or \
missing. The comment speaks to the detective in the given language.`;

export function judgePrompt(file: CaseFile, motive: string, lang: Lang): string {
  return `Language: ${LANG_NAMES[lang]}\nTrue motive: ${file.solution.motive}\nDetective's stated motive: ${motive || "(none given)"}`;
}

export function portraitPrompt(file: CaseFile, suspect: Suspect): string {
  return `${file.art_style}. Head-and-shoulders character portrait, no text. ${suspect.portrait_prompt} Setting: ${file.setting}`;
}

export function coverPrompt(file: CaseFile): string {
  return `${file.art_style}. Wide establishing illustration, no text, nothing graphic. ${file.cover_prompt}`;
}
