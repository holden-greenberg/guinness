"use strict";

// Cuisine chips — mirrors CUISINES in src/food.js (labels + ids only; the
// id -> OSM cuisine-value map lives server-side).
const CUISINES = [
  { id: "pizza", label: "Pizza" },
  { id: "burgers", label: "Burgers" },
  { id: "deli", label: "Sandwiches / Deli" },
  { id: "bagels", label: "Bagels" },
  { id: "mexican", label: "Tacos / Mexican" },
  { id: "chinese", label: "Chinese" },
  { id: "thai", label: "Thai" },
  { id: "sushi", label: "Sushi / Japanese" },
  { id: "ramen", label: "Ramen / Noodles" },
  { id: "korean", label: "Korean" },
  { id: "vietnamese", label: "Vietnamese" },
  { id: "indian", label: "Indian" },
  { id: "italian", label: "Italian / Pasta" },
  { id: "american", label: "American / Diner" },
  { id: "wings", label: "Wings / Fried chicken" },
  { id: "bbq", label: "BBQ" },
  { id: "steak", label: "Steakhouse" },
  { id: "seafood", label: "Seafood" },
  { id: "med", label: "Mediterranean / Greek" },
  { id: "mideast", label: "Middle Eastern / Falafel" },
  { id: "halal", label: "Halal cart" },
  { id: "french", label: "French" },
  { id: "healthy", label: "Salad / Healthy" },
  { id: "dessert", label: "Dessert / Ice cream" },
];
const HUNGER = [
  { id: "snack", label: "Snack" },
  { id: "meal", label: "Real meal" },
  { id: "feast", label: "Feast" },
];
const BUDGET = [
  { id: "low", label: "$" },
  { id: "mid", label: "$$" },
  { id: "high", label: "$$$" },
];

const $ = (id) => document.getElementById(id);
const $status = $("status");
const $results = $("results");
const $findBtn = $("findBtn");

const state = { hunger: "meal", budget: new Set(), cuisines: new Set(), maxWalkMin: 12 };
let busy = false;
let excludeSet = new Set();

function setStatus(msg, isError) {
  $status.textContent = msg || "";
  $status.classList.toggle("err", !!isError);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
  return payload;
}

function buildSeg(el, items, key, multi) {
  el.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg-btn";
    b.textContent = it.label;
    const isOn = () => (multi ? state[key].has(it.id) : state[key] === it.id);
    b.setAttribute("aria-pressed", String(isOn()));
    b.addEventListener("click", () => {
      if (multi) {
        if (state[key].has(it.id)) state[key].delete(it.id);
        else state[key].add(it.id);
        b.setAttribute("aria-pressed", String(state[key].has(it.id)));
      } else {
        state[key] = it.id;
        for (const sib of el.children) {
          sib.setAttribute("aria-pressed", String(sib === b));
        }
      }
    });
    el.append(b);
  }
}

function buildChips() {
  const wrap = $("cuisineChips");
  wrap.innerHTML = "";
  for (const c of CUISINES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = c.label;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      if (state.cuisines.has(c.id)) state.cuisines.delete(c.id);
      else state.cuisines.add(c.id);
      b.setAttribute("aria-pressed", String(state.cuisines.has(c.id)));
    });
    wrap.append(b);
  }
}

function renderPicks(picks) {
  $results.innerHTML = "";

  if (!picks.length) {
    const p = document.createElement("p");
    p.className = "loading";
    p.textContent = "Nothing open nearby matched that. Loosen a filter and try again.";
    $results.append(p);
    return;
  }

  picks.forEach((pick, i) => {
    const card = document.createElement("article");
    card.className = "pick-card";

    const top = document.createElement("div");
    top.className = "pick-top";
    const rank = document.createElement("span");
    rank.className = "pick-rank";
    rank.textContent = String(i + 1);
    const name = document.createElement("span");
    name.className = "pick-name";
    name.textContent = pick.name;
    top.append(rank, name);

    const meta = document.createElement("p");
    meta.className = "pick-meta";
    const tags = [];
    if (pick.cuisine) tags.push(pick.cuisine);
    if (pick.modes.includes("walk")) tags.push(pick.walkMin + " min walk");
    if (pick.modes.includes("delivery")) tags.push("delivers");
    if (pick.hours === "open") tags.push("open now");
    meta.textContent = tags.join("  ·  ");

    const reason = document.createElement("p");
    reason.className = "pick-reason";
    reason.textContent = pick.reason;

    const actions = document.createElement("div");
    actions.className = "pick-actions";
    for (const [label, href] of [
      ["Directions ↗", pick.mapsUrl],
      ["Order ↗", pick.orderUrl],
    ]) {
      const a = document.createElement("a");
      a.className = "pick-link";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      actions.append(a);
    }

    card.append(top, meta, reason, actions);
    $results.append(card);
  });

  const reroll = document.createElement("button");
  reroll.type = "button";
  reroll.className = "btn-reset reroll-btn";
  reroll.textContent = "Reroll";
  reroll.addEventListener("click", () => find(true));
  $results.append(reroll);
}

async function find(isReroll) {
  if (busy) return;
  busy = true;
  $findBtn.disabled = true;
  $findBtn.textContent = "Looking…";
  setStatus("");
  if (!isReroll) excludeSet = new Set();

  try {
    const res = await api("/api/food", {
      hunger: state.hunger,
      budget: [...state.budget],
      cuisines: [...state.cuisines],
      craving: $("craving").value.trim(),
      maxWalkMin: state.maxWalkMin,
      exclude: [...excludeSet],
    });
    const picks = res.picks || [];
    for (const p of picks) excludeSet.add(p.name);
    renderPicks(picks);
  } catch (e) {
    setStatus(e.message || "Something went wrong.", true);
  } finally {
    busy = false;
    $findBtn.disabled = false;
    $findBtn.textContent = "Find food";
  }
}

(function init() {
  buildSeg($("hungerSeg"), HUNGER, "hunger");
  buildSeg($("budgetSeg"), BUDGET, "budget", true);
  buildChips();
  const walk = $("walk");
  walk.addEventListener("input", () => {
    state.maxWalkMin = Number(walk.value);
    $("walkVal").textContent = walk.value;
  });
  $findBtn.addEventListener("click", () => find(false));
})();
