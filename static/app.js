const $ = (sel) => document.querySelector(sel);

const GENRE_LABELS = {
  fantasy: ["🗡️", "Fantasy"],
  scifi: ["🛰️", "Sci-fi"],
  noir: ["🕵️", "Noir"],
  horror: ["🕯️", "Horror"],
  pirate: ["🏴‍☠️", "Pirates"],
  cyberpunk: ["🌆", "Cyberpunk"],
  custom: ["✨", "Your own"],
};
const PHASES = {
  thinking: "The narrator is thinking…",
  writing: "",
  choosing: "Weighing your options…",
};
const ENDINGS = { victory: "✦ Victory ✦", defeat: "✦ The end ✦", bittersweet: "✦ An ending, of sorts ✦" };

let meta = null;
let journey = null;
let viewIndex = null; // index of an earlier step being viewed, or null for the present
let busy = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------------------------------------------------------- routing */

async function route() {
  const match = location.hash.match(/^#\/j\/([0-9a-f]+)$/);
  $("#home").hidden = !!match;
  $("#play").hidden = !match;
  if (match) await openJourney(match[1]);
  else await showHome();
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- home */

function buildSetupForm() {
  const box = $("#genres");
  for (const key of [...meta.genres, "custom"]) {
    const [glyph, label] = GENRE_LABELS[key] ?? ["✨", key];
    const el = document.createElement("label");
    el.className = "genre";
    el.innerHTML = `<input type="radio" name="genre" value="${key}"><span class="glyph"></span><b></b>`;
    el.querySelector(".glyph").textContent = glyph;
    el.querySelector("b").textContent = label;
    box.append(el);
  }
  box.querySelector("input").checked = true;
  box.addEventListener("change", () => {
    const custom = new FormData($("#new-journey")).get("genre") === "custom";
    $("#custom-genre-field").hidden = !custom;
    if (custom) $("#custom-genre-field input").focus();
  });

  const select = $("#language");
  for (const [code, name] of Object.entries(meta.languages)) select.add(new Option(name, code));
  const browser = (navigator.language || "en").slice(0, 2);
  if (browser in meta.languages) select.value = browser;

  $("#new-journey").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    let genre = form.get("genre");
    if (genre === "custom") genre = (form.get("custom") || "").trim() || "fantasy";
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const created = await api("/api/journeys", {
        method: "POST",
        body: { genre, hero: form.get("hero"), premise: form.get("premise"), language: form.get("language") },
      });
      location.hash = `#/j/${created.id}`;
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function showHome() {
  document.title = "GPT-Journey";
  const list = $("#journey-list");
  const journeys = await api("/api/journeys");
  list.replaceChildren();
  $("#no-journeys").hidden = journeys.length > 0;
  for (const j of journeys) {
    const item = $("#journey-item").content.cloneNode(true);
    const [, genreLabel] = GENRE_LABELS[j.genre] ?? ["", "Custom world"];
    item.querySelector(".j-open").href = `#/j/${j.id}`;
    item.querySelector(".j-title").textContent = j.title;
    item.querySelector(".j-meta").textContent =
      `${genreLabel} · ${j.steps} ${j.steps === 1 ? "scene" : "scenes"}${j.ended ? " · finished" : ""} · ${timeAgo(j.updated_at)}`;
    item.querySelector(".j-delete").addEventListener("click", async () => {
      if (!confirm(`Delete “${j.title}”?`)) return;
      await api(`/api/journeys/${j.id}`, { method: "DELETE" });
      showHome();
    });
    list.append(item);
  }
}

function timeAgo(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

/* ---------------------------------------------------------------- play */

async function openJourney(id) {
  viewIndex = null;
  try {
    journey = await api(`/api/journeys/${id}`);
  } catch (err) {
    location.hash = "#/";
    return;
  }
  renderTitle();
  if (journey.steps.length === 0) {
    clearStage();
    takeTurn(null);
  } else {
    renderStep();
  }
}

function currentIndex() {
  return viewIndex ?? journey.steps.length - 1;
}

function renderTitle() {
  $("#title").textContent = journey.title;
  document.title = `${journey.title} · GPT-Journey`;
}

function clearStage() {
  $("#narrative").replaceChildren();
  $("#choices").replaceChildren();
  $("#ending").hidden = true;
  $("#error").hidden = true;
  setArt(null);
}

function renderStep() {
  const i = currentIndex();
  const step = journey.steps[i];
  const isPresent = i === journey.steps.length - 1;
  $("#viewing").hidden = isPresent;
  $("#error").hidden = true;
  renderNarrative(step.narrative, { action: step.action });
  setArt(i);

  const ended = !!step.ending;
  $("#ending").hidden = !ended;
  $("#ending").textContent = ENDINGS[step.ending] ?? "";
  renderChoices(isPresent && !ended ? step.choices : []);
  $("#free-action").hidden = !isPresent || ended;
  renderSheet(step, journey.steps[i - 1]);
  renderTimeline();
}

function renderNarrative(text, { action = null, streaming = false } = {}) {
  const box = $("#narrative");
  box.replaceChildren();
  if (action) {
    const said = document.createElement("p");
    said.className = "said";
    said.textContent = `› ${action}`;
    box.append(said);
  }
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  if (!paragraphs.length && streaming) paragraphs.push("");
  paragraphs.forEach((para, idx) => {
    const p = document.createElement("p");
    p.textContent = para.trim();
    if (streaming && idx === paragraphs.length - 1) {
      const caret = document.createElement("span");
      caret.className = "caret";
      p.append(caret);
    }
    box.append(p);
  });
}

function renderChoices(choices) {
  const box = $("#choices");
  box.replaceChildren();
  choices.forEach((choice, idx) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.style.animationDelay = `${idx * 60}ms`;
    b.innerHTML = `<kbd>${idx + 1}</kbd><span></span>`;
    b.querySelector("span").textContent = choice;
    b.addEventListener("click", () => takeTurn(choice));
    box.append(b);
  });
}

function setArt(index) {
  const fig = $("#art");
  const img = $("#art-img");
  fig.classList.toggle("off", !meta.illustrations);
  fig.classList.remove("ready", "failed");
  fig.classList.toggle("idle", index === null);
  img.onload = img.onerror = null;
  img.removeAttribute("src");
  if (index === null || !meta.illustrations) return;
  const src = `/api/journeys/${journey.id}/steps/${index}/illustration.svg`;
  img.onload = () => { if (img.getAttribute("src") === src) fig.classList.add("ready"); };
  img.onerror = () => { if (img.getAttribute("src") === src) fig.classList.add("failed"); };
  img.src = src;
  img.alt = journey.steps[index]?.scene ?? "";
}

function renderSheet(step, previous) {
  const hp = step.state.health;
  const bar = $("#health-bar");
  bar.style.width = `${hp}%`;
  bar.style.backgroundColor = hp > 60 ? "var(--good)" : hp > 30 ? "var(--accent)" : "var(--danger)";
  $("#health-num").textContent = `${hp} / 100`;
  $("#location").textContent = step.state.location || "—";
  $("#objective").textContent = step.state.objective || "—";
  fillChips($("#inventory"), step.state.inventory, previous?.state.inventory ?? []);
  fillChips($("#companions"), step.state.companions, previous?.state.companions ?? []);
}

function fillChips(list, items, before) {
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      if (!before.includes(item)) li.className = "new";
      return li;
    }),
  );
}

function renderTimeline() {
  const list = $("#timeline");
  list.replaceChildren();
  const active = currentIndex();
  journey.steps.forEach((step, i) => {
    const li = document.createElement("li");
    if (i === active) li.className = "active";
    const b = document.createElement("button");
    b.textContent = i === 0 ? "The beginning" : step.action;
    b.title = step.action ?? "";
    b.disabled = busy;
    b.addEventListener("click", () => {
      viewIndex = i === journey.steps.length - 1 ? null : i;
      renderStep();
    });
    li.append(b);
    list.append(li);
  });
  list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function setStatus(phase) {
  const text = phase === null ? null : PHASES[phase];
  $("#status").hidden = !text;
  if (text) $("#status-text").textContent = text;
}

function setBusy(value) {
  busy = value;
  $("#free-input").disabled = value;
  $("#free-action button").disabled = value;
  document.querySelectorAll(".choice, .timeline button").forEach((b) => (b.disabled = value));
}

async function takeTurn(action) {
  if (busy) return;
  viewIndex = null;
  setBusy(true);
  $("#viewing").hidden = true;
  $("#error").hidden = true;
  $("#choices").replaceChildren();
  $("#free-input").value = "";
  setArt(null);
  let text = "";
  renderNarrative(text, { action, streaming: true });
  setStatus("thinking");

  try {
    const res = await fetch(`/api/journeys/${journey.id}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch {}
      throw new Error(detail);
    }
    for await (const { event, data } of readSSE(res.body)) {
      if (event === "phase") setStatus(data.phase);
      else if (event === "reset") { text = ""; renderNarrative(text, { action, streaming: true }); }
      else if (event === "text") {
        text += data.text;
        renderNarrative(text, { action, streaming: true });
        setStatus("writing");
      } else if (event === "error") throw new Error(data.message);
      else if (event === "step") {
        journey.steps.push(data.step);
        journey.title = data.title;
        renderTitle();
        setStatus(null);
        setBusy(false);
        renderStep();
        return;
      }
    }
    throw new Error("The connection closed before the scene finished.");
  } catch (err) {
    setStatus(null);
    setBusy(false);
    showError(err.message, action);
  }
}

function showError(message, action) {
  const box = $("#error");
  box.hidden = false;
  box.textContent = message;
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => takeTurn(action));
  box.append(retry);
  if (!journey.steps.length) {
    renderNarrative("");
  } else {
    // Restore the last scene's choices so the player is not stuck.
    const last = journey.steps.at(-1);
    renderNarrative(last.narrative, { action: last.action });
    setArt(journey.steps.length - 1);
    renderChoices(last.ending ? [] : last.choices);
  }
}

async function* readSSE(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      yield { event, data: data ? JSON.parse(data) : null };
    }
  }
}

/* ---------------------------------------------------------------- wiring */

$("#free-action").addEventListener("submit", (e) => {
  e.preventDefault();
  const action = $("#free-input").value.trim();
  if (action) takeTurn(action);
});

$("#present-btn").addEventListener("click", () => {
  viewIndex = null;
  renderStep();
});

$("#fork-btn").addEventListener("click", async () => {
  const fork = await api(`/api/journeys/${journey.id}/fork`, { method: "POST", body: { step: currentIndex() } });
  location.hash = `#/j/${fork.id}`;
});

document.addEventListener("keydown", (e) => {
  if ($("#play").hidden || busy || e.target.matches("input, textarea, select")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  const buttons = document.querySelectorAll(".choice");
  if (n >= 1 && n <= buttons.length) buttons[n - 1].click();
});

window.addEventListener("hashchange", route);

(async () => {
  meta = await api("/api/meta");
  const badge = $("#model-badge");
  badge.textContent = meta.model;
  badge.hidden = false;
  buildSetupForm();
  route();
})();
