from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Settings, settings as default_settings
from .models import GENRES, LANGUAGES, Journey, Setup, Step, WorldState
from .prompts import action_message, opening_message
from .storyteller import (
    ClaudeStoryteller,
    MockStoryteller,
    Phase,
    Reset,
    Storyteller,
    StoryError,
    TextDelta,
    TurnOutcome,
)
from .store import Store
from .svg import InvalidSVG, sanitize_svg

log = logging.getLogger("journey")
STATIC = Path(__file__).resolve().parent.parent / "static"
SVG_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Cache-Control": "private, max-age=31536000, immutable",
}


class TurnRequest(BaseModel):
    action: str | None = Field(default=None, max_length=500)


class ForkRequest(BaseModel):
    step: int = Field(ge=0)


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def next_user_message(journey: Journey, action: str | None) -> dict[str, Any]:
    if not journey.steps:
        return {"role": "user", "content": opening_message(journey.setup.describe())}
    last = journey.steps[-1]
    if last.ending:
        raise HTTPException(409, "This journey has ended. Fork an earlier step to try another path.")
    action = (action or "").strip()
    if not action:
        raise HTTPException(422, "An action is required.")
    text = action_message(action, choice=action in last.choices)
    tool_use = next(
        (b for b in journey.messages[-1]["content"] if isinstance(b, dict) and b.get("type") == "tool_use"),
        None,
    )
    if tool_use is None:
        return {"role": "user", "content": text}
    # The player's decision is the result of the `advance_story` call that offered the choices.
    return {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_use["id"], "content": text}]}


async def play_turn(journey: Journey, action: str | None, storyteller: Storyteller, store: Store) -> AsyncIterator[str]:
    messages = [*journey.messages, next_user_message(journey, action)]
    outcome: TurnOutcome | None = None
    try:
        async for event in storyteller.turn(messages):
            if isinstance(event, TextDelta):
                yield sse("text", {"text": event.text})
            elif isinstance(event, Phase):
                yield sse("phase", {"phase": event.name})
            elif isinstance(event, Reset):
                yield sse("reset", {})
            elif isinstance(event, TurnOutcome):
                outcome = event
    except StoryError as exc:
        yield sse("error", {"message": str(exc)})
        return
    except Exception:
        log.exception("turn failed")
        yield sse("error", {"message": "Something went wrong. Please try again."})
        return
    if outcome is None:
        yield sse("error", {"message": "The storyteller fell silent. Please try again."})
        return

    messages.append({"role": "assistant", "content": outcome.assistant_content})
    payload = outcome.payload
    previous_state = journey.steps[-1].state if journey.steps else WorldState()
    step = Step(
        index=len(journey.steps),
        action=action.strip() if journey.steps and action else None,
        narrative=outcome.narrative,
        choices=payload.choices if payload and not payload.ending else [],
        state=payload.state if payload else previous_state,
        scene=payload.scene if payload else outcome.narrative[:400],
        ending=payload.ending if payload else None,
        history_len=len(messages),
    )
    journey.steps.append(step)
    journey.messages = messages
    if step.index == 0 and payload and payload.title:
        journey.title = payload.title.strip()[:80]
    journey.updated_at = time.time()
    store.save(journey)
    yield sse("step", {"step": step.model_dump(), "title": journey.title})


def create_app(settings: Settings | None = None, storyteller: Storyteller | None = None) -> FastAPI:
    settings = settings or default_settings
    storyteller = storyteller or (MockStoryteller() if settings.mock else ClaudeStoryteller(settings))
    store = Store(settings.db_path)
    turn_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
    art_locks: defaultdict[tuple[str, int], asyncio.Lock] = defaultdict(asyncio.Lock)

    app = FastAPI(title="GPT-Journey")
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    def load(journey_id: str) -> Journey:
        journey = store.get(journey_id)
        if journey is None:
            raise HTTPException(404, "Journey not found.")
        return journey

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    @app.get("/api/meta")
    async def meta() -> dict[str, Any]:
        return {
            "genres": list(GENRES),
            "languages": LANGUAGES,
            "mock": settings.mock,
            "illustrations": settings.illustrations,
            "model": "offline mock" if settings.mock else settings.model,
        }

    @app.get("/api/journeys")
    async def list_journeys() -> list[dict[str, Any]]:
        return [j.summary() for j in store.list()]

    @app.post("/api/journeys", status_code=201)
    async def create_journey(setup: Setup) -> dict[str, Any]:
        journey = Journey(setup=setup)
        store.save(journey)
        return journey.public()

    @app.get("/api/journeys/{journey_id}")
    async def get_journey(journey_id: str) -> dict[str, Any]:
        return load(journey_id).public()

    @app.delete("/api/journeys/{journey_id}", status_code=204)
    async def delete_journey(journey_id: str) -> Response:
        if not store.delete(journey_id):
            raise HTTPException(404, "Journey not found.")
        return Response(status_code=204)

    @app.post("/api/journeys/{journey_id}/fork", status_code=201)
    async def fork_journey(journey_id: str, body: ForkRequest) -> dict[str, Any]:
        source = load(journey_id)
        if body.step >= len(source.steps):
            raise HTTPException(422, "No such step.")
        kept = source.steps[: body.step + 1]
        fork = Journey(
            title=f"{source.title} ↳ {body.step + 1}",
            setup=source.setup,
            steps=kept,
            # An exact prefix of the original history, so cached prompts and thinking stay valid.
            messages=source.messages[: kept[-1].history_len],
        )
        store.save(fork)
        store.copy_illustrations(source.id, fork.id, body.step)
        return fork.public()

    @app.post("/api/journeys/{journey_id}/turn")
    async def take_turn(journey_id: str, body: TurnRequest) -> StreamingResponse:
        lock = turn_locks[journey_id]
        if lock.locked():
            raise HTTPException(409, "A turn is already in progress for this journey.")
        journey = load(journey_id)
        next_user_message(journey, body.action)  # validate before opening the stream

        async def stream() -> AsyncIterator[str]:
            async with lock:
                async for chunk in play_turn(journey, body.action, storyteller, store):
                    yield chunk

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/journeys/{journey_id}/steps/{step}/illustration.svg")
    async def illustration(journey_id: str, step: int) -> Response:
        cached = store.get_illustration(journey_id, step)
        if cached is None:
            if not settings.illustrations:
                raise HTTPException(404, "Illustrations are disabled.")
            journey = load(journey_id)
            if not 0 <= step < len(journey.steps):
                raise HTTPException(404, "No such step.")
            async with art_locks[(journey_id, step)]:
                cached = store.get_illustration(journey_id, step)
                if cached is None:
                    try:
                        raw = await storyteller.illustrate(journey.steps[step].scene, journey.setup.genre)
                        cached = sanitize_svg(raw)
                    except (StoryError, InvalidSVG) as exc:
                        log.warning("illustration failed: %s", exc)
                        raise HTTPException(502, "Illustration failed.") from exc
                    store.save_illustration(journey_id, step, cached)
        return Response(cached, media_type="image/svg+xml", headers=SVG_HEADERS)

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(
        "journey.app:create_app",
        factory=True,
        host=os.environ.get("JOURNEY_HOST", "127.0.0.1"),
        port=int(os.environ.get("JOURNEY_PORT", "5001")),
    )


if __name__ == "__main__":
    main()
