# GPT-Journey: Case Files

A detective game where every murder is written fresh by AI, checked for fairness before you
see it, and every suspect is played by their own AI actor who knows only their side of the story.

Search the scenes for clues, interrogate the suspects, lay evidence on the table to break their
lies, then name the killer, the motive and your proof. The case file was sealed before you
started, so the answer is fixed and the mystery can actually be solved.

Runs entirely in the browser. Bring your own key for **Claude**, **OpenAI** or **Gemini**, or
play the built-in offline demo case.

## How a case works

1. **The architect** (one structured-output call) writes a complete, hidden case file: victim,
   3–5 suspects each with a real secret, lies, a claimed alibi, what they truly know and what makes
   them crack, locations, clues, red herrings, the solution and the true timeline.
2. **Mechanical checks** (`src/game/rules.ts`) verify the cross-references: one culprit, every clue
   in a real location, 3+ non-red-herring key clues, every innocent has something pointing at them.
   Failures go back to the model with the list of problems.
3. **The auditor** (a second, independent call) reads the case as a player would and flags
   contradictions or ambiguity; the case is repaired once if needed.
4. **Suspect actors**: each interrogation is a separate conversation whose system prompt holds
   only that suspect's character sheet. Innocents don't know who did it; only the culprit's actor
   knows the truth, and it confesses only when cornered with the right evidence.
5. **Your assistant** reads only what you've found and heard, and suggests what to try next.
6. **The verdict**: culprit and cited key evidence are scored mechanically; the motive is graded
   by the model against the sealed solution. Then everything is revealed: the explanation, what
   really happened, and every suspect's secret and lies.

Time is the resource: every search, question and consultation costs hours.

## Providers

| | Story & suspects | Illustrations |
|---|---|---|
| Claude | `claude-opus-5` (adaptive thinking, structured outputs, server-side refusal fallbacks) | — |
| OpenAI | `gpt-5.6` (Responses API, strict JSON schema) | `gpt-image-2` |
| Gemini | `gemini-3-flash-preview` (JSON schema, thinking levels) | `gemini-3.1-flash-image` |
| Demo | Offline, one hand-written case | Procedural placeholders |

Mix freely, e.g. Claude for the mystery with Gemini painting the portraits. Model names are
editable in Settings, and **Load list** fetches the models your key can use.

API keys stay in your browser and are sent only to the provider you choose. By default they are
forgotten when you close the tab; tick "Remember keys" to keep them in `localStorage`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # game logic + wire-format tests for all three SDKs (no network)
npm run build      # static site in dist/
```

The build is a static site with relative paths, so it can be hosted anywhere. The included
workflow deploys `main` to GitHub Pages; enable it under *Settings → Pages → Source: GitHub
Actions*.

## Layout

```
src/
  ai/         provider adapters (Claude, OpenAI, Gemini, offline demo) behind one interface
  game/       case schema (Zod → JSON Schema), rules & scoring, prompts, engine
  store/      IndexedDB (cases) and localStorage (settings)
  ui/         React components, English/Croatian UI
tests/        Vitest: game flow with the demo provider, request/response shape per SDK
```

## History

The [first version](https://github.com/shutzer/GPT-Journey/tree/e6e6144) (2023) was a Flask
choose-your-own-adventure on GPT-3.5 that pulled options out of free text with a regex.

## License

MIT
