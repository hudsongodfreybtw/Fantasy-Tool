# Draft Room

A phone-first draft assistant for Hudson's 12-team half-PPR "Degenerates" league
(Sleeper league `1389737725439004672`, snake, pick 7 of 12, 16 rounds).

It exists to answer one question in under 60 seconds: **who do I take right now?**

It watches your Sleeper draft live, keeps its own board of who's left, knows what
your roster still needs, and gives you a ranked shortlist of 3–5 names with one
line of reasoning each. Everything else in the app is there to support that one
screen.

---

## Quick start

The app is plain static files. No build step, no dependencies.

**Option A — GitHub Pages (best for drafting on your phone).**
Repo → Settings → Pages → Source: "Deploy from a branch" → pick the branch and
`/ (root)` → Save. A minute later it's at
`https://<your-username>.github.io/Fantasy-Tool/`. Open that on your phone and
add it to your home screen.

**Option B — laptop, phone on the same wifi.**
```sh
node server/proxy.mjs        # prints a http://192.168.x.x:8080 URL for your phone
```

**Option C — just open `index.html`.** Works from `file://` too, though live
sync needs a real network connection.

Everything (settings, picks, cached players) is stored in your browser, so a
refresh mid-draft loses nothing.

---

## The four screens

| Tab | What it's for |
|---|---|
| **Now** | The shortlist. Top 5 picks for *this* pick, one line of why each, plus who'll be gone by your next turn. This is the only screen you need while the clock runs. |
| **Board** | Every player, filterable by position, grouped into tiers with a live "N left" count so you can see a position about to fall off a cliff. Tap anyone to mark them drafted. |
| **Roster** | Your starters, empty slots, bench, bye-week distribution, position counts against target. |
| **Draft** | Sync setup, data refresh, manual pick entry, the full pick log, and the practice draft. Set this up before the draft and don't touch it during. |

---

## Practice draft

Draft tab → **Start practice draft**. Runs a fake 12-team draft against the real
board and the real engine: the other 11 teams pick themselves (roughly by board
order, RB/WR early, QB mid, K/DEF last, with some randomness), pausing at each of
your turns with the clock running. Your real draft is backed up on start and
restored on stop, and live sync is paused for the duration, so practice can never
touch a real pick.

## How the recommendation works

`score = value(board rank) × round strategy × roster fit × scarcity × value-vs-ADP × news`

Multiplicative on purpose. Early on, the gaps between players are enormous and
swamp roster need — which is what you want, because reaching in round 2 to "fill
a slot" is how people lose drafts. By round 12 the remaining players are nearly
interchangeable, so need and scarcity decide. The factors:

- **Round strategy** — the plan from the strategy doc, encoded literally: RB/WR
  through rounds 1–6, no QB before round 6 (this league gives QBs only 4 points
  a passing TD, and a startable one is always on waivers), TE either top-2 or
  wait, K and DEF in the last three rounds and never two of either.
- **Roster fit** — unfilled starter slots, FLEX pressure, and a depth curve that
  starts pushing back once you have four of something.
- **Must-fill** — with 16 rounds and mandatory QB/TE/K/DEF slots, there's a point
  where "best player available" is simply wrong. The engine counts remaining
  picks against unfilled mandatory slots and forces the issue when it has to.
- **Scarcity** — whether *this player's own tier* empties out before your next
  turn (11–13 picks away at slot 7), not the vaguer "position is thin".
- **Value vs ADP** — how far past his usual draft slot he's fallen.
- **News** — the injury/depth-chart layer, if you've loaded one. Penalties count
  roughly double in rounds 1–4, where a bust actually costs you the season.

Tap any recommendation to see the factor breakdown behind it.

---

## Data, and how fresh it is

The board ships with the 93 players from the strategy doc's Section 5 tiers
(4for4 half-PPR consensus, 8/25/2026). Ranks 1–24 are that doc's table verbatim;
ranks 25+ interleave its per-position tier lists. **That snapshot is stale by
draft day** — three ways to refresh, in order of effort:

1. **Load Sleeper player DB** (Draft tab, one tap). Pulls the full NFL player
   dictionary, fills in every player's team — and therefore bye week — adds ADP,
   and extends the board past 93 so it lasts all 16 rounds. Do this on wifi the
   night before. Cached locally; Sleeper asks that it be fetched at most once a
   day.
2. **Paste fresh rankings** (Draft tab). Takes numbered cheat sheets, FantasyPros
   CSV exports, or Boris Chen tier blocks — the parser is deliberately forgiving.
   Overrides ranks and tiers.
3. **`node scripts/import_rankings.mjs fresh.txt > data/board.js`** — same parser,
   for when you're at a laptop. Carries over tiers and byes you already have.

**Player notes** (the injury / depth-chart layer) come from `data/notes.js`,
empty by default. Fill it the day before by asking Claude Code in this repo to
run the `last30days` skill over the top 150 players, or paste notes into the app
as `Name | tag | note`.

**Bye weeks**: the doc only named 18 of 32 teams, so the rest are blank until you
load the Sleeper player DB or paste a bye chart (Draft tab → Bye weeks). Missing
byes don't break anything — they just skip that player's clash check.

---

## If live sync doesn't work

The app calls `api.sleeper.app` straight from your browser. That's the normal way
to use Sleeper's public read-only API, but I could not verify it end-to-end from
the sandbox this was built in (that host is blocked there), so check it once
before draft day: **Draft tab → Test connection**. It reports exactly which step
failed.

Two fallbacks, both fine:
- Run `node server/proxy.mjs` on a laptop and put its URL in "Proxy base".
- Turn off Auto-sync and mark picks by hand. Board tab → tap a player → "Another
  team drafted him", or Draft tab → search. There's a "someone took a player not
  on my board" button that just advances the pick counter, so your turn tracking
  stays correct no matter what.

---

## Files

```
index.html            app shell
assets/app.css        dark, mobile-first styling
assets/util.js        name matching, snake-draft math, safe storage
assets/state.js       single source of truth: settings, picks, merged player pool
assets/engine.js      the value model and recommendation engine
assets/sleeper.js     live Sleeper API client + polling
assets/demo.js        practice draft (fake opponents, real engine)
assets/ui.js          rendering
assets/main.js        wiring, paste importers
data/board.js         the player board (regenerate before draft day)
data/notes.js         injury / depth-chart layer (empty by default)
scripts/import_rankings.mjs   offline board rebuild
server/proxy.mjs      optional static server + CORS fallback proxy
DRAFT_DAY.md          the checklist to run on 9/5 and 9/6
```

See `DRAFT_DAY.md` before the draft.
