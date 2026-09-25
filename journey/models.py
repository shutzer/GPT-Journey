from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

LANGUAGES = {
    "en": "English",
    "hr": "Croatian",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
}

GENRES = {
    "fantasy": "high fantasy: ancient ruins, wild magic, old gods",
    "scifi": "hard-edged science fiction: derelict ships, strange signals, alien worlds",
    "noir": "rain-soaked 1940s noir: corruption, secrets, a city that never sleeps",
    "horror": "slow-burn cosmic horror: isolation, dread, things that should not be",
    "pirate": "golden-age piracy: cursed treasure, storms, mutiny on the high seas",
    "cyberpunk": "neon cyberpunk: megacorps, street samurai, memories for sale",
}


class Setup(BaseModel):
    genre: str = "fantasy"
    hero: str = Field(default="", max_length=60)
    premise: str = Field(default="", max_length=600)
    language: str = "en"

    @field_validator("language")
    @classmethod
    def _known_language(cls, v: str) -> str:
        if v not in LANGUAGES:
            raise ValueError(f"unsupported language {v!r}")
        return v

    @field_validator("genre")
    @classmethod
    def _genre(cls, v: str) -> str:
        v = v.strip()[:200]
        return v or "fantasy"

    def describe(self) -> str:
        genre = GENRES.get(self.genre, self.genre)
        lines = [
            f"Genre: {genre}",
            f"Narrate in {LANGUAGES[self.language]}.",
            f"The hero is {self.hero.strip()}." if self.hero.strip() else "Invent the hero.",
        ]
        if self.premise.strip():
            lines.append(f"Premise from the player: {self.premise.strip()}")
        return "\n".join(lines)


class WorldState(BaseModel):
    health: int = Field(default=100, ge=0, le=100)
    location: str = ""
    objective: str = ""
    inventory: list[str] = Field(default_factory=list)
    companions: list[str] = Field(default_factory=list)


class TurnPayload(BaseModel):
    """What Claude passes to the `advance_story` tool at the end of every scene."""

    scene: str = Field(min_length=1)
    choices: list[str] = Field(default_factory=list, max_length=4)
    state: WorldState
    title: str | None = None
    ending: Literal["victory", "defeat", "bittersweet"] | None = None


class Step(BaseModel):
    index: int
    action: str | None  # what the player did to reach this step; None for the opening
    narrative: str
    choices: list[str]
    state: WorldState
    scene: str
    ending: str | None = None
    # Length of the API message history once this step's assistant turn is appended.
    # Branching from this step truncates the history to exactly this prefix.
    history_len: int


class Journey(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    title: str = "Untitled journey"
    setup: Setup
    steps: list[Step] = Field(default_factory=list)
    # Raw Messages API history, content blocks stored verbatim (thinking blocks included)
    # so every request replays an append-only prefix.
    messages: list[dict[str, Any]] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return self.model_dump(exclude={"messages"})

    def summary(self) -> dict[str, Any]:
        last = self.steps[-1] if self.steps else None
        return {
            "id": self.id,
            "title": self.title,
            "genre": self.setup.genre,
            "steps": len(self.steps),
            "ended": bool(last and last.ending),
            "updated_at": self.updated_at,
        }
