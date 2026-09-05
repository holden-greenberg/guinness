// Food tab config — everything static about the "what should we eat" picker.
// No API keys, no billing: restaurant data comes from OpenStreetMap via the
// public Overpass API, ranked by Cloudflare Workers AI (same model the Games
// tab uses).

// The Dead Poet — 450 Amsterdam Ave #2, New York, NY 10024.
export const BAR = { lat: 40.7864, lng: -73.9764 };

// Cuisine chips shown in the UI. `match` is the set of OSM `cuisine` tag values
// (the tag is ";"-separated, matched case-insensitively) that count as this
// chip. Ordered roughly common -> niche.
export const CUISINES = [
  { id: "pizza", label: "Pizza", match: ["pizza"] },
  { id: "burgers", label: "Burgers", match: ["burger"] },
  { id: "deli", label: "Sandwiches / Deli", match: ["sandwich", "deli"] },
  { id: "bagels", label: "Bagels", match: ["bagel"] },
  { id: "mexican", label: "Tacos / Mexican", match: ["mexican", "taco", "tex-mex", "burrito"] },
  { id: "chinese", label: "Chinese", match: ["chinese", "cantonese", "szechuan"] },
  { id: "thai", label: "Thai", match: ["thai"] },
  { id: "sushi", label: "Sushi / Japanese", match: ["sushi", "japanese"] },
  { id: "ramen", label: "Ramen / Noodles", match: ["ramen", "noodle", "udon"] },
  { id: "korean", label: "Korean", match: ["korean"] },
  { id: "vietnamese", label: "Vietnamese", match: ["vietnamese"] },
  { id: "indian", label: "Indian", match: ["indian", "pakistani"] },
  { id: "italian", label: "Italian / Pasta", match: ["italian", "pasta"] },
  { id: "american", label: "American / Diner", match: ["american", "diner", "breakfast"] },
  { id: "wings", label: "Wings / Fried chicken", match: ["chicken", "wings", "fried_chicken"] },
  { id: "bbq", label: "BBQ", match: ["barbecue"] },
  { id: "steak", label: "Steakhouse", match: ["steak_house"] },
  { id: "seafood", label: "Seafood", match: ["seafood"] },
  { id: "med", label: "Mediterranean / Greek", match: ["mediterranean", "greek"] },
  { id: "mideast", label: "Middle Eastern / Falafel", match: ["middle_eastern", "falafel", "lebanese", "turkish"] },
  { id: "halal", label: "Halal cart", match: ["kebab", "halal"] },
  { id: "french", label: "French", match: ["french"] },
  { id: "healthy", label: "Salad / Healthy", match: ["salad", "vegetarian", "vegan", "poke", "bowl"] },
  { id: "dessert", label: "Dessert / Ice cream", match: ["ice_cream", "dessert", "cake", "donut"] },
];

export const CUISINE_BY_ID = new Map(CUISINES.map((c) => [c.id, c]));

export const HUNGER = [
  { id: "snack", label: "Snack" },
  { id: "meal", label: "Real meal" },
  { id: "feast", label: "Feast" },
];

// Budget tiers — multi-select; empty means "any". Soft signal to the AI only
// (OpenStreetMap has no price data to filter on).
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

export function mapsUrl(name, lat, lng) {
  const q = encodeURIComponent(`${name} @${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function orderUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(name + " delivery order")}`;
}
