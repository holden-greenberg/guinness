// Food tab config — everything static about the "what should we eat" picker.
// No API keys, no billing: restaurants come from src/restaurants.json, a list
// built ahead of time by scripts/refresh-restaurants.mjs. Chips, moods and the
// other flags below are worked out for each place when that list is built.

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

// Mood buttons: which chips count as each mood.
export const MOODS = [
  { id: "greasy", label: "Greasy", chips: ["pizza", "burgers", "wings", "mexican", "halal", "bbq"] },
  { id: "fresh", label: "Fresh", chips: ["sushi", "healthy", "med", "mideast", "vietnamese", "deli"] },
  { id: "spicy", label: "Spicy", chips: ["thai", "indian", "mexican", "halal", "vietnamese"] },
  { id: "comfort", label: "Comfort", chips: ["italian", "american", "chinese", "ramen", "deli", "pizza", "bbq"] },
];

// A best guess at what's easy to carry back and eat at the bar, since the data
// doesn't say who does takeout. A takeout tag on OpenStreetMap overrides this.
export const PORTABLE_CHIPS = [
  "pizza", "burgers", "deli", "bagels", "mexican", "chinese", "thai", "sushi", "vietnamese",
  "indian", "wings", "bbq", "med", "mideast", "halal", "healthy",
];
export const PORTABLE_CUISINES = [
  "Asian/Asian Fusion", "Southeast Asian", "Latin American", "Caribbean", "Jewish/Kosher",
  "Hotdogs", "Peruvian", "Spanish",
];
export const NOT_PORTABLE_NAME = /tavern|\bpub\b|wine|cocktail|lounge|steakhouse|omakase|ramen/i;

// Likely shut by dinner. Hidden in the evening unless their hours say otherwise.
export const DAYTIME_CUISINES = ["Bagels/Pretzels", "Pancakes/Waffles"];
export const DAYTIME_NAME = /bagel|breakfast|brunch|bakery/i;

export const WALK_MIN = 5;
export const WALK_MAX = 25;
export const WALK_DEFAULT = 8;

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

// The place's Google Maps page, which has its photos and reviews.
export function reviewsUrl(name, address) {
  const q = encodeURIComponent(`${name}, ${address}, New York, NY`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function directionsUrl(name, address) {
  const to = encodeURIComponent(`${name}, ${address}, New York, NY`);
  return `https://www.google.com/maps/dir/?api=1&origin=${BAR.lat},${BAR.lng}&destination=${to}&travelmode=walking`;
}

export function menuSearchUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(name + " NYC menu")}`;
}

export function orderUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(name + " NYC delivery order")}`;
}
