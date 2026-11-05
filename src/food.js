// Food tab config — everything static about the "what should we eat" picker.
// No API keys, no billing: restaurants come from src/restaurants.json, a list
// built ahead of time by scripts/refresh-restaurants.mjs, and are ranked by
// Cloudflare Workers AI (same model the Games tab uses).

// The Dead Poet — 450 Amsterdam Ave #2, New York, NY 10024.
export const BAR = { lat: 40.78485, lng: -73.97709 };

// Cuisine chips shown in the UI. Used when the restaurant list is built: a place
// gets a chip if its NYC health-department cuisine is in `match`, or its name
// fits the `name` pattern (the city files ramen shops under "Japanese", say).
// Ordered roughly common -> niche.
export const CUISINES = [
  { id: "pizza", label: "Pizza", match: ["Pizza"], name: "pizz" },
  { id: "burgers", label: "Burgers", match: ["Hamburgers"], name: "burger" },
  { id: "deli", label: "Sandwiches / Deli", match: ["Sandwiches", "Sandwiches/Salads/Mixed Buffet", "Soups/Salads/Sandwiches"], name: "\\bdeli\\b" },
  { id: "bagels", label: "Bagels", match: ["Bagels/Pretzels"], name: "bagel" },
  { id: "mexican", label: "Tacos / Mexican", match: ["Mexican", "Tex-Mex", "Southwestern"], name: "taco|burrito|taqueria" },
  { id: "chinese", label: "Chinese", match: ["Chinese", "Chinese/Cuban", "Chinese/Japanese"] },
  { id: "thai", label: "Thai", match: ["Thai"] },
  { id: "sushi", label: "Sushi / Japanese", match: ["Japanese", "Chinese/Japanese"], name: "sushi" },
  { id: "ramen", label: "Ramen / Noodles", match: [], name: "ramen|noodle|udon" },
  { id: "vietnamese", label: "Vietnamese", match: ["Vietnamese/Cambodian/Malaysia"], name: "\\bpho\\b|banh|viet" },
  { id: "indian", label: "Indian", match: ["Indian", "Pakistani"] },
  { id: "italian", label: "Italian / Pasta", match: ["Italian"], name: "pasta" },
  { id: "american", label: "American / Diner", match: ["American", "New American", "Californian", "Soul Food", "Pancakes/Waffles"], name: "diner" },
  { id: "wings", label: "Wings / Fried chicken", match: ["Chicken"], name: "\\bwings?\\b|wingstop" },
  { id: "bbq", label: "BBQ", match: ["Barbecue"], name: "bbq|barbecue|smokehouse" },
  { id: "steak", label: "Steakhouse", match: ["Steakhouse"], name: "steak" },
  { id: "seafood", label: "Seafood", match: ["Seafood"], name: "oyster" },
  { id: "med", label: "Mediterranean / Greek", match: ["Mediterranean", "Greek"] },
  { id: "mideast", label: "Middle Eastern / Falafel", match: ["Middle Eastern", "Turkish"], name: "falafel|shawarma|kebab" },
  { id: "halal", label: "Halal", match: [], name: "halal" },
  { id: "french", label: "French", match: ["French"], name: "bistro" },
  { id: "healthy", label: "Salad / Healthy", match: ["Salads", "Vegan", "Vegetarian"], name: "salad|poke" },
  { id: "dessert", label: "Dessert / Ice cream", match: ["Bakery Products/Desserts", "Frozen Desserts", "Donuts"], name: "ice cream|gelato" },
];

// Not dinner: these only show up for "Snack" or when a chip asks for them.
export const SNACK_KINDS = [
  "Coffee/Tea",
  "Juice, Smoothies, Fruit Salads",
  "Bakery Products/Desserts",
  "Frozen Desserts",
  "Donuts",
];

export const CUISINE_BY_ID = new Map(CUISINES.map((c) => [c.id, c]));

export const HUNGER = [
  { id: "snack", label: "Snack" },
  { id: "meal", label: "Real meal" },
  { id: "feast", label: "Feast" },
];

// Budget tiers — multi-select; empty means "any". Soft signal to the AI only
// (the restaurant data has no prices to filter on).
export const BUDGET = [
  { id: "low", label: "$" },
  { id: "mid", label: "$$" },
  { id: "high", label: "$$$" },
];

export const WALK_MIN = 5;
export const WALK_MAX = 25;
export const WALK_DEFAULT = 12;

// Straight-line metres between two lat/lng points.
export function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Rough walking minutes: straight-line * 1.3 detour factor / 80 m per minute.
export function walkMinutes(meters) {
  return Math.max(1, Math.round((meters * 1.3) / 80));
}

export function mapsUrl(name, address) {
  const q = encodeURIComponent(`${name}, ${address}, New York, NY`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function orderUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(name + " NYC delivery order")}`;
}
