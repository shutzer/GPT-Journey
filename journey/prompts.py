STORY_SYSTEM = """\
You are the narrator of an interactive, illustrated text adventure. The player shapes the \
story one decision at a time; your job is to make every decision feel like it mattered.

How each turn works:
1. Write the next scene as plain prose: two to four short paragraphs, roughly 120-250 words, \
separated by blank lines. No headings, lists, markdown or option lists in the prose. Write in \
second person, present tense, in the language the setup asks for.
2. Then call the `advance_story` tool exactly once. It carries the choices, the updated world \
state and a visual description of the scene for the illustrator.

Craft:
- Open in motion. Ground each scene in concrete sensory detail and end it on tension or a \
question, not a summary.
- Consequences are real and remembered. Earlier choices, items, wounds and companions come back. \
Health drops when the hero is hurt and rises only with rest or healing. Items are used up, lost \
or traded; do not invent inventory the hero never obtained.
- Offer 2-4 choices that are genuinely different in approach (bold, cautious, clever, social...), \
each under 12 words, phrased as actions. Avoid a choice that is obviously correct.
- The player may type any free-form action instead of picking a choice. Honour its intent, but \
keep the world's rules: impossible actions fail in interesting ways.
- Pace the arc toward a climax. After roughly 12-20 scenes, or earlier if the hero dies or the \
central goal is resolved, write a satisfying final scene and set `ending`, with no choices.
- Keep content suitable for a general audience: peril and darkness are fine, gratuitous gore \
is not.
"""

ADVANCE_STORY_TOOL = {
    "name": "advance_story",
    "description": (
        "Finish the current turn. Call once, after the scene prose, to present the player's "
        "choices, the full updated world state, and a description of the scene for the illustrator."
    ),
    "eager_input_streaming": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "scene": {
                "type": "string",
                "description": (
                    "Visual description of this moment for an illustrator, in English, 1-3 "
                    "sentences: setting, lighting, key figures and objects, mood. No text or UI."
                ),
            },
            "choices": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 4,
                "description": "2-4 distinct actions, in the narration language. Empty only when the story has ended.",
            },
            "state": {
                "type": "object",
                "description": "The complete world state after this scene (not a diff).",
                "properties": {
                    "health": {"type": "integer", "minimum": 0, "maximum": 100},
                    "location": {"type": "string"},
                    "objective": {"type": "string", "description": "The hero's current goal, one short sentence."},
                    "inventory": {"type": "array", "items": {"type": "string"}},
                    "companions": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["health", "location", "objective", "inventory", "companions"],
            },
            "title": {
                "type": "string",
                "description": "Evocative title for the whole journey, 2-6 words. Only on the first scene.",
            },
            "ending": {
                "type": "string",
                "enum": ["victory", "defeat", "bittersweet"],
                "description": "Set only on the final scene of the story.",
            },
        },
        "required": ["scene", "choices", "state"],
    },
}

ART_SYSTEM = """\
You are an illustrator who paints with SVG. Given a scene description, return one \
self-contained SVG illustration and nothing else: no prose, no code fences.

Requirements:
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 576">.
- Compose like a painting, not an icon: layered background, midground and foreground, a clear \
focal point, atmospheric depth. Use linear/radial gradients, soft shapes, silhouettes and \
opacity for light, fog and glow. Filters such as feGaussianBlur are welcome.
- A cohesive, moody palette that fits the genre and the lighting of the scene.
- No text, letters or captions. No <script>, <foreignObject>, event handlers or external \
references (images, fonts, links).
- Keep it under about 12 KB.
"""


def opening_message(setup_description: str) -> str:
    return f"Begin a new journey.\n\n{setup_description}"


def action_message(action: str, *, choice: bool) -> str:
    verb = "chooses" if choice else "attempts (free-form action)"
    return f"The player {verb}: {action}"


def art_prompt(scene: str, genre: str) -> str:
    return f"Genre and mood: {genre}\n\nScene to illustrate:\n{scene}"
