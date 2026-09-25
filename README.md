# GPT-Journey 2

An illustrated, branching text adventure narrated live by Claude.

Pick a world (or describe your own), then play by choosing one of the offered actions or typing
anything you like. Every scene streams in as it's written, gets its own illustration, and updates
your character sheet. You can rewind to any earlier moment and fork it into a new path.

The [original GPT-Journey](https://github.com/shutzer/GPT-Journey/tree/e6e6144) (2023) was a
single Flask route that asked GPT-3.5 for a story, pulled the options out with a regex, and
generated a DALL·E image. This is a ground-up rewrite built around what current models do well.

## What changed

| 2023 | Now |
|---|---|
| Options scraped from free text with `re.findall(r"Option \d:.*")` | Claude ends each scene with an `advance_story` tool call: validated choices, world state, scene description, title, ending |
| Wait for the whole reply, then reload the page | Narrative streams token by token over Server-Sent Events |
| Only the listed buttons | Pick a choice (or press `1`–`4`) or type any free-form action |
| No memory beyond the chat log | Health, location, objective, inventory and companions tracked every turn |
| Story never ends | Paced arc with a real ending (victory, defeat, bittersweet) |
| Lost on refresh; history in a signed cookie | Journeys saved in SQLite, resumable from the home page |
| — | Timeline of every step; fork any moment into a new journey |
| DALL·E URL that expires | Claude paints each scene as SVG, sanitised and cached |
| English only | English, Croatian, German, Spanish, French, Italian |
| API key read from `key.txt`, hard-coded Flask secret | Credentials from the environment, nothing secret in the repo |

## Run it

Requires Python 3.11+.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...
gpt-journey            # http://127.0.0.1:5001
```

No key? `JOURNEY_MOCK=1 gpt-journey` plays a canned offline story with procedural art, which is
handy for working on the UI.

### Configuration

| Variable | Default | |
|---|---|---|
| `JOURNEY_MODEL` | `claude-opus-5` | Model for narration and illustration |
| `JOURNEY_STORY_EFFORT` | `medium` | Effort for narration (`low` … `max`) |
| `JOURNEY_ART_EFFORT` | `low` | Effort for SVG illustrations |
| `JOURNEY_NO_ILLUSTRATIONS` | off | Skip illustrations (halves API usage) |
| `JOURNEY_NO_FALLBACKS` | off | Disable server-side refusal fallbacks (needed on Bedrock / Vertex / Foundry) |
| `JOURNEY_MOCK` | off | Offline storyteller, no API calls |
| `JOURNEY_DB` | `journeys.db` | SQLite file |
| `JOURNEY_HOST` / `JOURNEY_PORT` | `127.0.0.1` / `5001` | Bind address |

## How it works

```
browser ── POST /api/journeys/{id}/turn ──▶ FastAPI ──▶ Claude (streaming)
   ▲                                          │            thinking → prose → advance_story(...)
   └──────── SSE: phase / text / step ◀───────┘
   └── <img src=".../steps/{n}/illustration.svg"> ──▶ Claude paints SVG ──▶ sanitise ──▶ SQLite cache
```

- **One append-only conversation per journey.** The player's decision is sent back as the
  `tool_result` of the `advance_story` call that offered it. Assistant turns are stored verbatim,
  thinking blocks included, and a fork copies an exact prefix of the history, so prompt caching
  and adaptive thinking stay valid across turns and branches.
- **Refusals.** Requests opt into server-side fallbacks (`fallbacks: "default"`); if a model
  declines mid-scene, the UI discards the partial text and the fallback model continues.
- **SVG safety.** Illustrations pass an element and attribute allow-list (no scripts, event
  handlers, `foreignObject` or external references) and are served with a restrictive CSP and
  rendered through `<img>`.

```
journey/
  app.py          FastAPI routes, turn loop, SSE
  storyteller.py  Claude client (streaming + tool use) and the offline mock
  prompts.py      System prompts and the advance_story tool schema
  models.py       Pydantic models: setup, world state, steps, journeys
  store.py        SQLite persistence
  svg.py          SVG sanitiser
static/           Single-page UI (vanilla JS, no build step)
tests/            API tests (mock storyteller) and a wire-format test against a fake Messages API
```

## Tests

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT
