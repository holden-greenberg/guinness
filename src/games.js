// Card games we play at The Dead Poet. Rules text lives in public/rules/<file>
// (served as static assets and read by the /api/ask handler via env.ASSETS).
export const GAMES = [
  {
    id: "99",
    name: "99 (Ninety-Nine)",
    url: "https://bicyclecards.com/how-to-play/99-ninety-nine",
    file: "99.txt",
  },
  {
    id: "egyptian-rat-screw",
    name: "Egyptian Rat Screw",
    url: "https://bicyclecards.com/how-to-play/egyptian-rat-screw",
    file: "egyptian-rat-screw.txt",
  },
  {
    id: "monopoly-deal",
    name: "Monopoly Deal",
    url: "https://monopolydealrules.com/index.php?page=general",
    file: "monopoly-deal.txt",
  },
];

export const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));
