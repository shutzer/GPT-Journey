import json

import pytest
from fastapi.testclient import TestClient

from journey.app import create_app
from journey.config import Settings
from journey.storyteller import MockStoryteller, extract_turn
from journey.svg import InvalidSVG, sanitize_svg


@pytest.fixture
def client(tmp_path):
    settings = Settings(mock=True, db_path=tmp_path / "test.db")
    return TestClient(create_app(settings, MockStoryteller(delay=0)))


def events(response):
    out = []
    for chunk in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def new_journey(client, **setup):
    r = client.post("/api/journeys", json={"genre": "fantasy", "language": "hr", **setup})
    assert r.status_code == 201
    return r.json()["id"]


def turn(client, jid, action=None):
    r = client.post(f"/api/journeys/{jid}/turn", json={"action": action})
    assert r.status_code == 200, r.text
    evs = events(r)
    assert evs[-1][0] == "step", evs[-1]
    return evs


def test_opening_turn_streams_text_and_persists_step(client):
    jid = new_journey(client)
    evs = turn(client, jid)
    kinds = [e for e, _ in evs]
    assert "text" in kinds and kinds.count("step") == 1
    streamed = "".join(d["text"] for e, d in evs if e == "text")
    step = evs[-1][1]["step"]
    assert step["narrative"] == streamed.strip()
    assert step["action"] is None and len(step["choices"]) == 3
    assert evs[-1][1]["title"] == "The Bell Beneath"

    j = client.get(f"/api/journeys/{jid}").json()
    assert j["title"] == "The Bell Beneath"
    assert "messages" not in j


def test_choice_is_sent_back_as_tool_result(client, tmp_path):
    jid = new_journey(client)
    first = turn(client, jid)[-1][1]["step"]
    turn(client, jid, first["choices"][0])

    # Reach into the store to check the raw history the model will see next turn.
    from journey.store import Store
    j = Store(tmp_path / "test.db").get(jid)
    roles = [m["role"] for m in j.messages]
    assert roles == ["user", "assistant", "user", "assistant"]
    result = j.messages[2]["content"][0]
    tool_use = j.messages[1]["content"][1]
    assert result["type"] == "tool_result" and result["tool_use_id"] == tool_use["id"]
    assert "chooses: Follow the figure" in result["content"]
    assert j.steps[1].history_len == 4


def test_free_form_action_is_labelled(client, tmp_path):
    jid = new_journey(client)
    turn(client, jid)
    turn(client, jid, "Climb the bell tower")
    from journey.store import Store
    j = Store(tmp_path / "test.db").get(jid)
    assert "free-form action" in j.messages[2]["content"][0]["content"]


def test_action_required_after_opening(client):
    jid = new_journey(client)
    turn(client, jid)
    r = client.post(f"/api/journeys/{jid}/turn", json={"action": "  "})
    assert r.status_code == 422


def test_story_ends_and_blocks_further_turns(client):
    jid = new_journey(client)
    turn(client, jid)
    for _ in range(5):
        last = turn(client, jid, "Follow the figure")[-1][1]["step"]
    assert last["ending"] == "bittersweet" and last["choices"] == []
    r = client.post(f"/api/journeys/{jid}/turn", json={"action": "keep going"})
    assert r.status_code == 409


def test_fork_copies_exact_history_prefix(client, tmp_path):
    jid = new_journey(client)
    turn(client, jid)
    turn(client, jid, "Follow the figure")
    turn(client, jid, "Search the area")
    client.get(f"/api/journeys/{jid}/steps/0/illustration.svg")

    fork = client.post(f"/api/journeys/{jid}/fork", json={"step": 1}).json()
    assert len(fork["steps"]) == 2 and fork["id"] != jid

    from journey.store import Store
    store = Store(tmp_path / "test.db")
    original, forked = store.get(jid), store.get(fork["id"])
    assert forked.messages == original.messages[:4]
    assert store.get_illustration(fork["id"], 0) is not None

    turn(client, fork["id"], "Call out to them")
    assert len(store.get(jid).steps) == 3  # original untouched


def test_illustration_is_sanitized_and_cached(client):
    jid = new_journey(client)
    turn(client, jid)
    r = client.get(f"/api/journeys/{jid}/steps/0/illustration.svg")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert r.text.startswith("<svg")
    assert client.get(f"/api/journeys/{jid}/steps/0/illustration.svg").text == r.text
    assert client.get(f"/api/journeys/{jid}/steps/9/illustration.svg").status_code == 404


def test_list_and_delete(client):
    a, b = new_journey(client), new_journey(client, genre="noir")
    ids = [j["id"] for j in client.get("/api/journeys").json()]
    assert set(ids) == {a, b}
    assert client.delete(f"/api/journeys/{a}").status_code == 204
    assert client.get(f"/api/journeys/{a}").status_code == 404


def test_rejects_unknown_language(client):
    r = client.post("/api/journeys", json={"genre": "fantasy", "language": "xx"})
    assert r.status_code == 422


def test_extract_turn_ignores_blocks_before_fallback():
    content = [
        {"type": "text", "text": "partial from declined model"},
        {"type": "fallback", "from": {"model": "a"}, "to": {"model": "b"}},
        {"type": "thinking", "thinking": "", "signature": "x"},
        {"type": "text", "text": "The real scene."},
        {"type": "tool_use", "id": "t1", "name": "advance_story", "input": {
            "scene": "s", "choices": ["a", "b"],
            "state": {"health": 90, "location": "L", "objective": "O", "inventory": [], "companions": []},
        }},
    ]
    narrative, payload = extract_turn(content)
    assert narrative == "The real scene."
    assert payload and payload.choices == ["a", "b"]


def test_extract_turn_tolerates_invalid_tool_input():
    content = [
        {"type": "text", "text": "Scene."},
        {"type": "tool_use", "id": "t1", "name": "advance_story", "input": {"scene": "s", "state": {"health": 500}}},
    ]
    narrative, payload = extract_turn(content)
    assert narrative == "Scene." and payload is None


def test_sanitize_svg_strips_active_content():
    raw = """Here you go:
    <svg viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><div>x</div></foreignObject>
      <style>@import url(http://evil/x.css);</style>
      <image href="http://evil/x.png"/>
      <rect width="10" height="10" fill="url(#g)" onclick="x()"/>
      <use href="#g"/>
      <circle r="2" style="fill:url(http://evil/p)"/>
    </svg> hope you like it"""
    out = sanitize_svg(raw)
    for bad in ("script", "onload", "onclick", "foreignObject", "evil", "@import", "<image"):
        assert bad not in out
    assert 'fill="url(#g)"' in out and 'href="#g"' in out


@pytest.mark.parametrize("raw", ["no svg here", '<svg><!ENTITY x "y"></svg>', "<svg><g></svg>"])
def test_sanitize_svg_rejects_bad_input(raw):
    with pytest.raises(InvalidSVG):
        sanitize_svg(raw)
