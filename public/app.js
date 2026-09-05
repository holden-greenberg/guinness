"use strict";

const $app = document.getElementById("app");
const $session = document.getElementById("session");
const $sessionTotal = document.getElementById("sessionTotal");
const $resetBtn = document.getElementById("resetBtn");
const $saveBtn = document.getElementById("saveBtn");
const $status = document.getElementById("status");

const POLL_MS = 4000;
let state = null;
let busy = false; // true while a write is in flight — pauses polling render churn

function setStatus(msg, isError) {
  $status.textContent = msg || "";
  $status.classList.toggle("err", !!isError);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function render() {
  if (!state) return;

  $app.innerHTML = "";
  for (const p of state.people) {
    const onWall = p.lifetime >= state.goal;
    const pct = Math.min(100, Math.round((p.lifetime / state.goal) * 100));

    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <h2 class="card-name"></h2>
        <span class="card-tonight">tonight <b>${p.tonight}</b></span>
      </div>
      <div class="lifetime">
        <span class="num" data-num>${p.lifetime}</span>
        <span class="of">/ ${state.goal}</span>
      </div>
      ${
        onWall
          ? `<span class="on-wall">On the wall 🏆</span>`
          : `<div class="bar"><span style="width:${pct}%"></span></div>`
      }
      <div class="card-actions">
        <button type="button" class="btn-drink" data-drink>+1 Guinness</button>
        <button type="button" class="btn-undo" data-undo ${
          p.tonight === 0 ? "disabled" : ""
        }>Undo</button>
      </div>
    `;
    card.querySelector(".card-name").textContent = p.name;
    card.querySelector("[data-drink]").addEventListener("click", () => logDrink(p.id));
    card.querySelector("[data-undo]").addEventListener("click", () => undoDrink(p.id));
    $app.appendChild(card);
  }

  $sessionTotal.textContent = state.tonightTotal;
  $saveBtn.hidden = state.tonightTotal === 0;
  $session.hidden = false;
}

function bump(personId) {
  const cards = $app.querySelectorAll(".card");
  const idx = state.people.findIndex((p) => p.id === personId);
  const num = cards[idx] && cards[idx].querySelector("[data-num]");
  if (num) {
    num.classList.remove("bump");
    void num.offsetWidth; // restart animation
    num.classList.add("bump");
  }
}

async function logDrink(personId) {
  if (busy) return;
  busy = true;
  // optimistic
  const p = state.people.find((x) => x.id === personId);
  p.lifetime += 1;
  p.tonight += 1;
  state.tonightTotal += 1;
  render();
  bump(personId);
  setStatus("Saved ✓");
  try {
    state = await api("/api/drink", { person: personId });
    render();
  } catch (e) {
    setStatus("Couldn't save that tap — check signal", true);
    try {
      state = await api("/api/state");
      render();
    } catch (_) {}
  } finally {
    busy = false;
  }
}

async function undoDrink(personId) {
  if (busy) return;
  busy = true;
  try {
    state = await api("/api/undo", { person: personId });
    render();
    setStatus("Removed one");
  } catch (e) {
    setStatus("Undo failed — try again", true);
  } finally {
    busy = false;
  }
}

async function resetTonight() {
  if (busy) return;
  if (!confirm("Start a fresh session? Tonight's counters go back to 0 without being saved. Lifetime totals stay.")) {
    return;
  }
  busy = true;
  try {
    state = await api("/api/reset-tonight", {});
    render();
    setStatus("New session started");
  } catch (e) {
    setStatus("Reset failed — try again", true);
  } finally {
    busy = false;
  }
}

async function saveTonight() {
  if (busy) return;
  const summary = state.people
    .filter((p) => p.tonight > 0)
    .map((p) => `${p.name.split(" ")[0]} ${p.tonight}`)
    .join(", ");
  if (!confirm(`Save tonight to the history page as today's session?\n\n${summary}\n\nThe tonight counter resets; lifetime totals are unchanged.`)) {
    return;
  }
  busy = true;
  try {
    state = await api("/api/log-tonight", {});
    render();
    setStatus("Saved to history ✓");
  } catch (e) {
    setStatus("Save failed — try again", true);
  } finally {
    busy = false;
  }
}

async function poll() {
  if (!busy) {
    try {
      state = await api("/api/state");
      render();
    } catch (_) {
      /* keep showing last known state */
    }
  }
  setTimeout(poll, POLL_MS);
}

$resetBtn.addEventListener("click", resetTonight);
$saveBtn.addEventListener("click", saveTonight);

(async function init() {
  try {
    state = await api("/api/state");
    render();
  } catch (e) {
    $app.innerHTML = `<p class="loading">Couldn't reach the bar tab. Refresh to try again.</p>`;
  }
  setTimeout(poll, POLL_MS);
})();
