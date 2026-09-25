"""Talks to Claude. Everything model-specific lives here; the rest of the app sees events."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic
from pydantic import ValidationError

from .config import Settings
from .models import TurnPayload
from .prompts import ADVANCE_STORY_TOOL, ART_SYSTEM, STORY_SYSTEM, art_prompt

log = logging.getLogger(__name__)


@dataclass
class Phase:
    name: str  # "thinking" | "writing" | "choosing"


@dataclass
class TextDelta:
    text: str


@dataclass
class Reset:
    """The narrative streamed so far was discarded (a refusal fallback switched models)."""


@dataclass
class TurnOutcome:
    narrative: str
    payload: TurnPayload | None
    assistant_content: list[dict[str, Any]]


StoryEvent = Phase | TextDelta | Reset | TurnOutcome


class StoryError(Exception):
    """A failure with a message that is safe and useful to show the player."""


class Storyteller(Protocol):
    def turn(self, messages: list[dict[str, Any]]) -> AsyncIterator[StoryEvent]: ...
    async def illustrate(self, scene: str, genre: str) -> str: ...


def extract_turn(content: list[dict[str, Any]]) -> tuple[str, TurnPayload | None]:
    """Narrative prose and validated tool payload from an assistant turn's content blocks."""
    # After a refusal fallback, blocks before the last `fallback` marker belong to the model
    # that declined; only what follows is the story.
    start = max((i + 1 for i, b in enumerate(content) if b.get("type") == "fallback"), default=0)
    blocks = content[start:]
    narrative = "".join(b["text"] for b in blocks if b.get("type") == "text").strip()
    payload = None
    for block in blocks:
        if block.get("type") == "tool_use" and block.get("name") == ADVANCE_STORY_TOOL["name"]:
            try:
                payload = TurnPayload.model_validate(block.get("input"))
            except ValidationError as exc:
                log.warning("advance_story input failed validation: %s", exc)
    return narrative, payload


class ClaudeStoryteller:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: anthropic.AsyncAnthropic | None = None

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            self._client = anthropic.AsyncAnthropic()
        return self._client

    def _common(self, effort: str) -> dict[str, Any]:
        params: dict[str, Any] = {
            "model": self.settings.model,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
        }
        if self.settings.fallbacks:
            # On a safety decline, re-run server-side on Anthropic's recommended fallback model.
            params["betas"] = ["server-side-fallback-2026-07-01"]
            params["fallbacks"] = "default"
        return params

    async def turn(self, messages: list[dict[str, Any]]) -> AsyncIterator[StoryEvent]:
        yield Phase("thinking")
        for attempt in range(2):
            try:
                async with self.client.beta.messages.stream(
                    max_tokens=16000,
                    system=STORY_SYSTEM,
                    tools=[ADVANCE_STORY_TOOL],
                    messages=messages,
                    cache_control={"type": "ephemeral"},
                    **self._common(self.settings.story_effort),
                ) as stream:
                    async for event in stream:
                        if event.type == "content_block_start":
                            kind = event.content_block.type
                            if kind == "text":
                                yield Phase("writing")
                            elif kind == "tool_use":
                                yield Phase("choosing")
                            elif kind == "fallback":
                                yield Reset()
                                yield Phase("thinking")
                        elif event.type == "text":
                            yield TextDelta(event.text)
                    final = await stream.get_final_message()
                break
            except ValueError:
                # Tool input JSON the SDK could not parse at all (eager input streaming).
                # No tool_use id to answer, so re-issue the turn once.
                if attempt:
                    raise StoryError("The storyteller lost the thread. Please try again.")
                yield Reset()
                yield Phase("thinking")
            except anthropic.APIError as exc:
                raise StoryError(_describe_api_error(exc)) from exc
            except TypeError as exc:  # raised by the SDK when no credentials can be resolved
                raise StoryError(_NO_CREDENTIALS) from exc

        if final.stop_reason == "refusal":
            raise StoryError("The storyteller declined to narrate that. Try a different action.")
        if final.stop_reason == "max_tokens":
            raise StoryError("The scene ran too long and was cut off. Please try again.")

        content = [b.model_dump(mode="json", by_alias=True, exclude_none=True) for b in final.content]
        narrative, payload = extract_turn(content)
        yield TurnOutcome(narrative=narrative, payload=payload, assistant_content=content)

    async def illustrate(self, scene: str, genre: str) -> str:
        try:
            async with self.client.beta.messages.stream(
                max_tokens=16000,
                system=ART_SYSTEM,
                messages=[{"role": "user", "content": art_prompt(scene, genre)}],
                **self._common(self.settings.art_effort),
            ) as stream:
                final = await stream.get_final_message()
        except anthropic.APIError as exc:
            raise StoryError(_describe_api_error(exc)) from exc
        except TypeError as exc:
            raise StoryError(_NO_CREDENTIALS) from exc
        if final.stop_reason != "end_turn":
            raise StoryError(f"Illustration failed ({final.stop_reason}).")
        return "".join(b.text for b in final.content if b.type == "text")


_NO_CREDENTIALS = (
    "No Anthropic credentials found. Set ANTHROPIC_API_KEY, or start with JOURNEY_MOCK=1 to play offline."
)


def _describe_api_error(exc: anthropic.APIError) -> str:
    if isinstance(exc, anthropic.AuthenticationError):
        return "The Anthropic API rejected the credentials. Check ANTHROPIC_API_KEY."
    if isinstance(exc, anthropic.RateLimitError):
        return "Rate limited by the Anthropic API. Wait a moment and try again."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API. Check your connection."
    if isinstance(exc, anthropic.APIStatusError):
        log.error("Anthropic API error %s: %s", exc.status_code, exc.message)
        if exc.status_code >= 500:
            return "The Anthropic API is having trouble. Try again shortly."
        return f"The Anthropic API rejected the request ({exc.status_code})."
    log.exception("Unexpected Anthropic SDK error")
    return "Unexpected error talking to the Anthropic API."


# --------------------------------------------------------------------------------------
# Offline storyteller: deterministic, instant, no credentials. Used by tests and JOURNEY_MOCK=1.
# --------------------------------------------------------------------------------------

_PLACES = ["a moss-choked stair", "the drowned library", "a bridge of chains", "the lantern market",
           "an observatory open to the storm", "the bone orchard", "a hall of cracked mirrors"]
_ITEMS = ["brass compass", "vial of starlight", "rusted key", "folded map", "silver whistle"]


class MockStoryteller:
    def __init__(self, delay: float = 0.01) -> None:
        self.delay = delay

    async def turn(self, messages: list[dict[str, Any]]) -> AsyncIterator[StoryEvent]:
        n = sum(1 for m in messages if m["role"] == "assistant")
        rng = random.Random(n)
        place = _PLACES[n % len(_PLACES)]
        yield Phase("thinking")
        await asyncio.sleep(self.delay)
        yield Phase("writing")
        text = (
            f"You arrive at {place}. The air tastes of rain and old iron, and somewhere far below "
            f"a bell rings {n + 1} times.\n\n"
            "A figure in a grey cloak watches you from the shadows, then turns away as if "
            "expecting you to follow."
        )
        for word in text.split(" "):
            yield TextDelta(word + " ")
            await asyncio.sleep(self.delay)
        yield Phase("choosing")
        ending = "bittersweet" if n >= 5 else None
        payload = {
            "scene": f"A lone traveller at {place}, a cloaked figure in shadow, rain and lantern light.",
            "choices": [] if ending else ["Follow the figure", "Call out to them", "Search the area"],
            "state": {
                "health": max(0, 100 - 12 * n),
                "location": place.removeprefix("a ").removeprefix("an ").removeprefix("the ").capitalize(),
                "objective": "Learn who is guiding you, and why.",
                "inventory": _ITEMS[: 1 + n % len(_ITEMS)],
                "companions": ["Grey-cloaked stranger"] if n >= 2 else [],
            },
            "title": "The Bell Beneath" if n == 0 else None,
            "ending": ending,
        }
        content = [
            {"type": "text", "text": text},
            {"type": "tool_use", "id": f"toolu_mock_{n}_{rng.randrange(10**6)}",
             "name": "advance_story", "input": {k: v for k, v in payload.items() if v is not None}},
        ]
        narrative, parsed = extract_turn(content)
        yield TurnOutcome(narrative=narrative, payload=parsed, assistant_content=content)

    async def illustrate(self, scene: str, genre: str) -> str:
        await asyncio.sleep(self.delay)
        return procedural_svg(scene)


def procedural_svg(seed_text: str) -> str:
    """A layered night landscape seeded from the scene text."""
    rng = random.Random(hashlib.sha256(seed_text.encode()).digest())
    hue = rng.randrange(360)
    sky1, sky2 = f"hsl({hue},45%,12%)", f"hsl({(hue + 40) % 360},55%,38%)"
    moon_x, moon_y = rng.randrange(150, 870), rng.randrange(70, 200)
    layers = []
    for depth in range(4):
        y0 = 300 + depth * 60
        pts = [f"0,{y0}"]
        for x in range(0, 1025, 64):
            pts.append(f"{x},{y0 - rng.randrange(20, 120 - depth * 20)}")
        pts += ["1024,576", "0,576"]
        light = 30 - depth * 7
        layers.append(f'<polygon points="{" ".join(pts)}" fill="hsl({hue},30%,{light}%)" opacity="0.95"/>')
    stars = "".join(
        f'<circle cx="{rng.randrange(1024)}" cy="{rng.randrange(300)}" r="{rng.random() * 1.6 + 0.3:.1f}" '
        f'fill="#fff" opacity="{rng.random() * 0.7 + 0.2:.2f}"/>'
        for _ in range(70)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 576">'
        f'<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky1}"/>'
        f'<stop offset="1" stop-color="{sky2}"/></linearGradient>'
        '<radialGradient id="glow"><stop offset="0" stop-color="#fff8e0" stop-opacity="0.9"/>'
        '<stop offset="1" stop-color="#fff8e0" stop-opacity="0"/></radialGradient>'
        '<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0.18"/></linearGradient></defs>'
        '<rect width="1024" height="576" fill="url(#sky)"/>'
        f"{stars}"
        f'<circle cx="{moon_x}" cy="{moon_y}" r="120" fill="url(#glow)"/>'
        f'<circle cx="{moon_x}" cy="{moon_y}" r="34" fill="#fdf6dc"/>'
        f'{"".join(layers)}'
        '<rect y="330" width="1024" height="246" fill="url(#fog)"/>'
        "</svg>"
    )
