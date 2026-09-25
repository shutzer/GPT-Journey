import os
from dataclasses import dataclass
from pathlib import Path


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    model: str = os.environ.get("JOURNEY_MODEL", "claude-opus-5")
    # Narration benefits from some deliberation; illustrations are routine work.
    story_effort: str = os.environ.get("JOURNEY_STORY_EFFORT", "medium")
    art_effort: str = os.environ.get("JOURNEY_ART_EFFORT", "low")
    # Server-side refusal fallbacks (Claude API only). Disable on Bedrock/Vertex/Foundry.
    fallbacks: bool = not _flag("JOURNEY_NO_FALLBACKS")
    illustrations: bool = not _flag("JOURNEY_NO_ILLUSTRATIONS")
    # Offline mode: canned storyteller, no API calls. Handy for UI work and tests.
    mock: bool = _flag("JOURNEY_MOCK")
    db_path: Path = Path(os.environ.get("JOURNEY_DB", "journeys.db"))


settings = Settings()
