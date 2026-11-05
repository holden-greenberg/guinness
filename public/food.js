"use strict";

// Labels and ids only — mirrors MOODS and CUISINES in src/food.js. Which places
// fit which is decided when the restaurant list is built.
const MOODS = [
  { id: "greasy", label: "Greasy" },
  { id: "fresh", label: "Fresh" },
  { id: "spicy", label: "Spicy" },
  { id: "comfort", label: "Comfort" },
];
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
  { id: "halal", label: "Halal" },
  { id: "french", label: "French" },
  { id: "healthy", label: "Salad / Healthy" },
  { id: "dessert", label: "Dessert / Ice cream" },
];
const CARDS_ON_SCREEN = 3;

const $ = (id) => document.getElementById(id);
const $results = $("results");

const state = { mood: null, cuisines: new Set(), query: "", maxWalkMin: 8, eatOut: false };
let pool = []; // places from the server not shown yet
let shown = []; // the cards on screen
let latestRequest = 0;

// Next place from the pool, preferring a cuisine not already in `avoid`, so the
// choices on screen are actually different from each other.
function takeNext(avoid) {
  if (!pool.length) return null;
  const i = pool.findIndex((p) => !avoid.includes(p.cuisine));
  return pool.splice(Math.max(i, 0), 1)[0];
}

function dealCards() {
  shown = [];
  while (shown.length < CARDS_ON_SCREEN && pool.length) {
    shown.push(takeNext(shown.map((p) => p.cuisine)));
  }
}

function veto(pick) {
  const avoid = [pick.cuisine, ...shown.filter((p) => p !== pick).map((p) => p.cuisine)];
  const replacement = takeNext(avoid);
  const i = shown.indexOf(pick);
  if (replacement) shown[i] = replacement;
  else shown.splice(i, 1);
  render();
}

async function load() {
  const request = ++latestRequest;
  $results.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/food", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...state, cuisines: [...state.cuisines] }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const { picks } = await res.json();
    if (request !== latestRequest) return; // a newer tap already replaced this
    pool = picks;
    dealCards();
    render();
  } catch {
    if (request === latestRequest) renderMessage("Couldn't load picks.", "Try again", load);
  } finally {
    if (request === latestRequest) $results.removeAttribute("aria-busy");
  }
}

function threeMore() {
  if (pool.length) {
    dealCards();
    render();
  } else {
    load(); // seen them all, so start over with a fresh shuffle
  }
}

function link(label, href, className) {
  const a = document.createElement("a");
  a.className = className;
  a.href = href;
  a.textContent = label;
  if (!href.startsWith("tel:")) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  return a;
}

function textLine(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function card(pick) {
  const article = document.createElement("article");
  article.className = "pick-card";

  const top = document.createElement("div");
  top.className = "pick-top";
  const name = document.createElement("span");
  name.className = "pick-name";
  name.textContent = pick.name;
  const nah = document.createElement("button");
  nah.type = "button";
  nah.className = "pick-nah";
  nah.textContent = "Nah";
  nah.setAttribute("aria-label", `Not ${pick.name}, show another`);
  nah.addEventListener("click", () => veto(pick));
  top.append(name, nah);

  const walk = pick.eatOut ? `${pick.walkMin} min walk` : `${pick.walkMin} min each way`;
  const tags = [pick.cuisine, walk];
  if (pick.delivers) tags.push("delivers");
  if (pick.grade) tags.push("Health " + pick.grade);

  const hours = textLine("pick-hours", pick.hours);
  hours.classList.toggle("unknown", !pick.hours.startsWith("Open"));

  const main = document.createElement("div");
  main.className = "pick-main";
  main.append(link("Menu", pick.menuUrl, "pick-btn"));
  if (pick.phone) main.append(link("Call to order", "tel:" + pick.phone, "pick-btn"));

  const more = document.createElement("div");
  more.className = "pick-actions";
  more.append(
    link("Delivery options ↗", pick.orderUrl, "pick-link"),
    link("Photos & reviews ↗", pick.reviewsUrl, "pick-link"),
    link("Directions ↗", pick.directionsUrl, "pick-link")
  );

  article.append(top, textLine("pick-meta", tags.join("  ·  ")), textLine("pick-meta", pick.address), hours, main, more);
  return article;
}

function renderMessage(text, buttonLabel, onClick) {
  $results.innerHTML = "";
  $results.append(textLine("loading", text));
  if (buttonLabel) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-reset reroll-btn";
    b.textContent = buttonLabel;
    b.addEventListener("click", onClick);
    $results.append(b);
  }
}

function render() {
  if (!shown.length) {
    renderMessage("Nothing left that fits. Try another mood or widen More options.", "Start over", load);
    return;
  }
  $results.innerHTML = "";
  for (const pick of shown) $results.append(card(pick));
  const more = document.createElement("button");
  more.type = "button";
  more.className = "btn-reset reroll-btn";
  more.textContent = "Three more";
  more.addEventListener("click", threeMore);
  $results.append(more);
}

function pressGroup(container, items, isOn, onPress) {
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = container.classList.contains("chips") ? "chip" : "seg-btn";
    b.textContent = item.label;
    b.setAttribute("aria-pressed", String(isOn(item)));
    b.addEventListener("click", () => {
      onPress(item);
      for (const [i, sib] of [...container.children].entries()) {
        sib.setAttribute("aria-pressed", String(isOn(items[i])));
      }
      load();
    });
    container.append(b);
  }
}

(function init() {
  pressGroup(
    $("moods"),
    MOODS,
    (m) => state.mood === m.id,
    (m) => (state.mood = state.mood === m.id ? null : m.id)
  );
  pressGroup(
    $("plan"),
    [
      { id: "back", label: "Bring it back" },
      { id: "out", label: "Eat out" },
    ],
    (p) => state.eatOut === (p.id === "out"),
    (p) => (state.eatOut = p.id === "out")
  );
  pressGroup(
    $("cuisineChips"),
    CUISINES,
    (c) => state.cuisines.has(c.id),
    (c) => (state.cuisines.has(c.id) ? state.cuisines.delete(c.id) : state.cuisines.add(c.id))
  );

  const walk = $("walk");
  walk.addEventListener("input", () => ($("walkVal").textContent = walk.value));
  walk.addEventListener("change", () => {
    state.maxWalkMin = Number(walk.value);
    load();
  });

  $("query").addEventListener("change", (e) => {
    state.query = e.target.value.trim();
    load();
  });

  load();
})();
