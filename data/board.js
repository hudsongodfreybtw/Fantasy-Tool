/* =============================================================================
   board.js — curated player board for Hudson's "Degenerates" league
   -----------------------------------------------------------------------------
   SOURCE OF TRUTH: fantasydraftstrategy.pdf, Section 5 (4for4 consensus,
   half-PPR, snapshot dated 2026-08-25).

   Ranks 1-24 are taken verbatim from the doc's "Overall Top 24" table
   (name, position, team, bye).  Ranks 25+ are derived by interleaving the
   doc's per-position tier lists into a single board using the strategy in
   Section 4 (RB/WR-heavy early, QB suppressed, TE either top-2 or wait).
   Order *within* a tier follows the doc's listing order.

   team/bye are `null` for any player the doc did not give a team for.  That is
   deliberate — do NOT guess.  The app fills them in at draft time from the
   Sleeper player dictionary (Draft tab -> "Load Sleeper player DB"), and byes
   come from BYES below.

   THIS FILE WILL BE ~2 WEEKS STALE BY 9/6. Refresh it before the draft:
     - Draft tab -> "Load Sleeper player DB"  (adds ADP + every missing player)
     - Draft tab -> "Paste fresh rankings"    (overrides ranks/tiers)
     - or: node scripts/import_rankings.mjs rankings.txt > data/board.js
   ========================================================================== */

window.BOARD_DATA = (function () {
  // Bye weeks confirmed by the doc's top-24 table. 14 teams were not named
  // there and are left out on purpose; fill them in on the Draft tab
  // (Settings -> bye weeks) or paste a bye chart. Unknown bye = no clash check.
  var BYES = {
    DET: 6, ATL: 11, CIN: 6, LAR: 11, IND: 13, SF: 8, SEA: 11, BUF: 7,
    MIA: 6, PHI: 10, MIN: 6, KC: 5, LV: 13, BAL: 13, LAC: 7, DAL: 14,
    NE: 11, HOU: 8
  };

  // [name, pos, team, tier]  — rank is array order (1-based).
  var ROWS = [
    // ---- Doc Section 5, "Overall Top 24" (verbatim) -------------------------
    ["Jahmyr Gibbs",           "RB", "DET", 1],
    ["Bijan Robinson",         "RB", "ATL", 1],
    ["Ja'Marr Chase",          "WR", "CIN", 1],
    ["Puka Nacua",             "WR", "LAR", 1],
    ["Jonathan Taylor",        "RB", "IND", 1],
    ["Christian McCaffrey",    "RB", "SF",  1],
    ["Jaxon Smith-Njigba",     "WR", "SEA", 1],
    ["Amon-Ra St. Brown",      "WR", "DET", 2],
    ["James Cook",             "RB", "BUF", 2],
    ["De'Von Achane",          "RB", "MIA", 2],
    ["Saquon Barkley",         "RB", "PHI", 3],
    ["Chase Brown",            "RB", "CIN", 3],
    ["Justin Jefferson",       "WR", "MIN", 2],
    ["Kenneth Walker",         "RB", "KC",  3],
    ["Drake London",           "WR", "ATL", 3],
    ["Ashton Jeanty",          "RB", "LV",  3],
    ["Derrick Henry",          "RB", "BAL", 3],
    ["Omarion Hampton",        "RB", "LAC", 3],
    ["CeeDee Lamb",            "WR", "DAL", 3],
    ["A.J. Brown",             "WR", "NE",  3],
    ["Kyren Williams",         "RB", "LAR", 4],
    ["Brock Bowers",           "TE", "LV",  1],
    ["Nico Collins",           "WR", "HOU", 4],
    ["Josh Allen",             "QB", "BUF", 1],
    // ---- Ranks 25+ : doc tier lists, interleaved ---------------------------
    ["Trey McBride",           "TE", null, 1],
    ["George Pickens",         "WR", null, 4],
    ["Chris Olave",            "WR", null, 4],
    ["Jeremiyah Love",         "RB", null, 4],
    ["Lamar Jackson",          "QB", null, 2],
    ["Javonte Williams",       "RB", null, 4],
    ["DeVonta Smith",          "WR", null, 4],
    ["Zay Flowers",            "WR", null, 4],
    ["Tee Higgins",            "WR", null, 4],
    ["Colston Loveland",       "TE", null, 2],
    ["Tyler Warren",           "TE", null, 2],
    ["Cam Skattebo",           "RB", "NYG", 5],
    ["Breece Hall",            "RB", null, 5],
    ["Rashee Rice",            "WR", null, 5],
    ["Ladd McConkey",          "WR", null, 5],
    ["Tucker Kraft",           "TE", null, 2],
    ["Travis Etienne",         "RB", null, 5],
    ["Tetairoa McMillan",      "WR", null, 5],
    ["D'Andre Swift",          "RB", null, 5],
    ["Garrett Wilson",         "WR", null, 5],
    ["Quinshon Judkins",       "RB", null, 5],
    ["Jaylen Waddle",          "WR", null, 5],
    ["Bucky Irving",           "RB", null, 6],
    ["MarShawn Lloyd",            "RB", "GB", 6],
    ["Emeka Egbuka",           "WR", null, 6],
    ["David Montgomery",       "RB", null, 6],
    ["Terry McLaurin",         "WR", null, 6],
    ["Bhayshul Tuten",         "RB", null, 6],
    ["Davante Adams",          "WR", null, 6],
    ["Jadarian Price",         "RB", null, 6],
    ["D.J. Moore",             "WR", null, 7],
    ["TreVeyon Henderson",     "RB", null, 6],
    ["Drake Maye",             "QB", null, 3],
    ["Joe Burrow",             "QB", null, 3],
    ["Jayden Daniels",         "QB", null, 3],
    ["Jalen Hurts",            "QB", null, 3],
    ["Rhamondre Stevenson",    "RB", null, 6],
    ["Christian Watson",       "WR", null, 7],
    ["Jaylen Warren",          "RB", null, 6],
    ["Jameson Williams",       "WR", null, 7],
    ["Harold Fannin",          "TE", null, 3],
    ["Kyle Pitts",             "TE", null, 3],
    ["Luther Burden",          "WR", null, 8],
    ["Rome Odunze",            "WR", null, 8],
    ["Sam LaPorta",            "TE", null, 3],
    ["George Kittle",          "TE", null, 3],
    ["Mike Evans",             "WR", null, 8],
    ["Brian Thomas Jr",        "WR", null, 8],
    ["Jonathon Brooks",        "RB", null, 7],
    ["Rico Dowdle",            "RB", null, 7],
    ["DK Metcalf",             "WR", null, 9],
    ["Chris Godwin",           "WR", null, 9],
    ["Marvin Harrison Jr.",    "WR", null, 9],
    ["Alec Pierce",               "WR", "IND", 8],
    ["Stefon Diggs",              "WR", "WAS", 8],
    ["Tyrone Tracy Jr",           "RB", "NYG", 8],
    ["Tony Pollard",           "RB", null, 7],
    ["Carnell Tate",           "WR", null, 8],
    ["Parker Washington",      "WR", null, 8],
    ["RJ Harvey",              "RB", null, 8],
    ["Jordan Mason",           "RB", null, 8],
    ["Malik Nabers",              "WR", "NYG", 6],
    ["Kenneth Gainwell",       "RB", null, 8],
    ["Jacory Croskey-Merritt", "RB", null, 8],
    ["J.K. Dobbins",           "RB", null, 8],
    ["Caleb Williams",         "QB", null, 4],
    ["Justin Herbert",         "QB", null, 4],
    ["Dak Prescott",           "QB", null, 4],
    ["Trevor Lawrence",        "QB", null, 4],
    ["Travis Kelce",           "TE", null, 4],
    ["Mark Andrews",           "TE", null, 4],
    ["Dallas Goedert",         "TE", null, 4],
    ["Kaleb Johnson",             "RB", "GB", 8],
    ["Josh Jacobs",               "RB", "GB", 9],
    // Late-round fliers and handcuffs (9/6 sweep)
    ["Tank Bigsby",               "RB",  null, 8],
    ["Nick Singleton",            "RB",  null, 8],
    ["Keaton Mitchell",           "RB",  null, 8],
    ["Chris Rodriguez Jr.",       "RB",  null, 8],
    ["Jaydon Blue",               "RB",  null, 8],
    ["Zachariah Branch",          "WR",  "ATL", 9],
    // Kickers and defenses (9/6 consensus) - rounds 14-16 only.
    ["Ka'imi Fairbairn",          "K",   "HOU", 1],
    ["Jason Myers",               "K",   "SEA", 1],
    ["Harrison Mevis",            "K",   "LAR", 1],
    ["HOU D/ST",                  "DEF", "HOU", 1],
    ["DEN D/ST",                  "DEF", "DEN", 1],
    ["LAR D/ST",                  "DEF", "LAR", 1],
    ["SEA D/ST",                  "DEF", "SEA", 1],
    ["PHI D/ST",                  "DEF", "PHI", 1]
  ];

  var players = ROWS.map(function (r, i) {
    return {
      name: r[0], pos: r[1], team: r[2], tier: r[3],
      rank: i + 1,
      bye: r[2] && BYES[r[2]] != null ? BYES[r[2]] : null,
      adp: null,          // filled by Sleeper DB load or pasted rankings
      source: 'doc'
    };
  });

  return {
    generated: '2026-09-06',
    source: "strategy doc 8/25 tiers, revised 9/6 from live news + ADP",
    byes: BYES,
    players: players
  };
})();
