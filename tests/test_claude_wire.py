"""Drive ClaudeStoryteller against a fake Messages API stream to check the wire format both ways."""

import asyncio
import json

import anthropic
import httpx2 as httpx

from journey.config import Settings
from journey.storyteller import ClaudeStoryteller, Phase, Reset, TextDelta, TurnOutcome

TOOL_INPUT = {
    "scene": "A lighthouse in a storm.",
    "choices": ["Climb", "Wait"],
    "state": {"health": 80, "location": "Lighthouse", "objective": "Reach the lamp", "inventory": ["rope"], "companions": []},
    "title": "Lamp of Storms",
}


def sse_body() -> str:
    tool_json = json.dumps(TOOL_INPUT)
    events = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5", "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 0}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "thinking", "thinking": "", "signature": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "signature_delta", "signature": "sig123"}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("content_block_start", {"type": "content_block_start", "index": 1,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "text_delta", "text": "Waves crash.\n\n"}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "text_delta", "text": "The door creaks."}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ("content_block_start", {"type": "content_block_start", "index": 2, "content_block": {
            "type": "tool_use", "id": "toolu_1", "name": "advance_story", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 2,
                                 "delta": {"type": "input_json_delta", "partial_json": tool_json[:40]}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 2,
                                 "delta": {"type": "input_json_delta", "partial_json": tool_json[40:]}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 2}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None},
                           "usage": {"output_tokens": 50}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events)


def test_turn_round_trip():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text=sse_body(), headers={"content-type": "text/event-stream"})

    teller = ClaudeStoryteller(Settings(model="claude-opus-5"))
    teller._client = anthropic.AsyncAnthropic(
        api_key="test", http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx.MockTransport(handler))
    )

    async def run():
        return [e async for e in teller.turn([{"role": "user", "content": "Begin"}])]

    evs = asyncio.run(run())

    body = seen["body"]
    assert body["model"] == "claude-opus-5" and body["stream"] is True
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "medium"}
    assert body["fallbacks"] == "default"
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["tools"][0]["name"] == "advance_story" and body["tools"][0]["eager_input_streaming"] is True
    assert "server-side-fallback-2026-07-01" in seen["headers"]["anthropic-beta"]

    assert "".join(e.text for e in evs if isinstance(e, TextDelta)) == "Waves crash.\n\nThe door creaks."
    assert [e.name for e in evs if isinstance(e, Phase)] == ["thinking", "writing", "choosing"]
    assert not any(isinstance(e, Reset) for e in evs)

    outcome = evs[-1]
    assert isinstance(outcome, TurnOutcome)
    assert outcome.narrative == "Waves crash.\n\nThe door creaks."
    assert outcome.payload.title == "Lamp of Storms" and outcome.payload.state.inventory == ["rope"]
    # Thinking block (with signature) is kept verbatim for the next request.
    assert outcome.assistant_content[0] == {"type": "thinking", "thinking": "", "signature": "sig123"}
    assert outcome.assistant_content[2]["input"] == TOOL_INPUT


def test_fallbacks_can_be_disabled():
    teller = ClaudeStoryteller(Settings(fallbacks=False))
    params = teller._common("low")
    assert "fallbacks" not in params and "betas" not in params
