"use strict";

const $gameSelect = document.getElementById("gameSelect");
const $question = document.getElementById("question");
const $askBtn = document.getElementById("askBtn");
const $answers = document.getElementById("answers");
const $gameList = document.getElementById("gameList");
const $status = document.getElementById("status");

let games = [];
let asking = false;

function setStatus(msg, isError) {
  $status.textContent = msg || "";
  $status.classList.toggle("err", !!isError);
}

async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
  return payload;
}

function renderGameList() {
  $gameList.innerHTML = "";
  const heading = document.createElement("h2");
  heading.className = "ask-title";
  heading.textContent = "The games";
  $gameList.append(heading);

  for (const g of games) {
    const card = document.createElement("article");
    card.className = "game-card";

    const row = document.createElement("div");
    row.className = "game-card-top";
    const name = document.createElement("span");
    name.className = "game-name";
    name.textContent = g.name;
    const link = document.createElement("a");
    link.className = "game-link";
    link.href = g.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Official rules ↗";
    row.append(name, link);
    card.append(row);

    const details = document.createElement("details");
    details.className = "game-rules";
    const summary = document.createElement("summary");
    summary.textContent = "Show rules text";
    const pre = document.createElement("pre");
    pre.className = "game-rules-text";
    pre.textContent = "Loading…";
    details.append(summary, pre);
    details.addEventListener(
      "toggle",
      async () => {
        if (details.open && pre.dataset.loaded !== "1") {
          try {
            const r = await fetch("/rules/" + fileFor(g.id));
            pre.textContent = await r.text();
          } catch {
            pre.textContent = "Couldn't load the rules text.";
          }
          pre.dataset.loaded = "1";
        }
      }
    );
    card.append(details);
    $gameList.append(card);
  }
}

// mirrors src/games.js
function fileFor(id) {
  return (
    {
      "99": "99.txt",
      "egyptian-rat-screw": "egyptian-rat-screw.txt",
      "monopoly-deal": "monopoly-deal.txt",
    }[id] || ""
  );
}

function addAnswer(gameName, question, answer, isError) {
  const item = document.createElement("article");
  item.className = "answer" + (isError ? " answer-err" : "");
  const q = document.createElement("p");
  q.className = "answer-q";
  q.textContent = question;
  const meta = document.createElement("p");
  meta.className = "answer-meta";
  meta.textContent = gameName;
  const a = document.createElement("p");
  a.className = "answer-a";
  a.textContent = answer;
  item.append(meta, q, a);
  $answers.prepend(item);
}

async function ask() {
  if (asking) return;
  const gameId = $gameSelect.value;
  const question = $question.value.trim();
  const game = games.find((g) => g.id === gameId);
  if (question.length < 3) {
    setStatus("Type a question first", true);
    return;
  }
  asking = true;
  $askBtn.disabled = true;
  $askBtn.textContent = "Thinking…";
  setStatus("");
  try {
    const res = await api("/api/ask", "POST", { gameId, question });
    addAnswer(res.game.name, question, res.answer, false);
    $question.value = "";
  } catch (e) {
    addAnswer(game ? game.name : "", question, e.message || "Something went wrong.", true);
  } finally {
    asking = false;
    $askBtn.disabled = false;
    $askBtn.textContent = "Ask";
  }
}

$askBtn.addEventListener("click", ask);
$question.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
});

(async function init() {
  try {
    const res = await api("/api/games");
    games = res.games;
    $gameSelect.innerHTML = "";
    for (const g of games) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      $gameSelect.append(opt);
    }
    renderGameList();
  } catch (e) {
    $gameList.innerHTML = `<p class="loading">Couldn't load games. Refresh to try again.</p>`;
  }
})();
