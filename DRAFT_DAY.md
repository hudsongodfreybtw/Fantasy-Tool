# Draft day checklist

Draft: **Sunday 9/6, 7:30pm PDT / 8:30pm MDT** (you'll be in Colorado — the app
shows nothing timezone-dependent, but set your own alarm for the right zone).
12 teams, snake, you pick 7th. Your picks: **7, 18, 31, 42, 55, 66, 79, 90, 103,
114, 127, 138, 151, 162, 175, 186**.

---

## Saturday 9/5 (or any time before Sunday afternoon)

- [ ] **Open the app and leave it open for a minute.** Draft tab → **Test
      connection**. You want three green checks: league reachable, draft found,
      pick feed works. If the draft hasn't been created in Sleeper yet, the
      second check will fail — that's expected, just re-test on Sunday.
- [ ] **Draft tab → Load Sleeper player DB.** On wifi. Takes a few seconds, ~5MB.
      This is the single most valuable prep step: it fills in every player's team
      and bye week, adds ADP, and makes the board deep enough to last 16 rounds.
- [ ] **Refresh the rankings.** Grab a current half-PPR ranking (FantasyPros,
      4for4) and either paste it into Draft tab → *Paste fresh rankings*, or run
      `node scripts/import_rankings.mjs fresh.txt > data/board.js`. The built-in
      board is from 8/25 and won't reflect roster cuts or camp injuries.
- [ ] **Load the news layer.** In Claude Code, in this repo:
      > Run the last30days skill on the top 150 players in data/board.js for
      > injury, depth-chart and preseason-role news, then rewrite data/notes.js
      This is the part your friends' cheat sheets won't have. It matters most for
      rounds 1–4, where the engine weights injury flags roughly double.
- [ ] **Fill in missing bye weeks** if you skipped the player DB load
      (Draft tab → Bye weeks).
- [ ] **Add the page to your phone's home screen** so it opens full-screen.

## Sunday, 15 minutes before

- [ ] Open the app. Draft tab → check **Auto-sync** is on, hit **Connect**.
- [ ] Confirm the top bar shows a green **Live** dot.
- [ ] Confirm your slot: it should say "Slot 7 detected from your username". If
      not, set *My draft slot* to 7 by hand.
- [ ] Plug your phone in. A 16-round draft with a 3-second poll will eat battery.

## During the draft

Stay on the **Now** tab. That's it.

- The top card is the pick. The one-line reason under each name tells you why.
- After you pick, tap **"I drafted <name>"** on that card. (Auto-sync will
  confirm it within a few seconds anyway — the tap just makes the board correct
  instantly instead of three seconds later.)
- Tap a card to expand it if you have a spare moment: survival odds, tier depth,
  factor breakdown.
- **"If you wait until pick N"** shows who'll be gone vs. still there next turn.
  This is how you decide between two similar players: take the one who won't
  last.
- Glance at **Roster** between turns if the warnings mention an empty slot.

## If something breaks mid-draft

Nothing here is fatal — you can always draft off the Board tab.

| Symptom | Fix |
|---|---|
| Red dot / "Sync error" | Keep drafting. Board tab → tap a player → "Another team drafted him". The pick counter stays correct. |
| Board is missing players | Draft tab → "Someone took a player not on my board" advances the pick counter without needing the name. |
| App shows the wrong pick number | Draft tab → pick log → undo, or Reset draft and re-Connect (Sleeper will re-feed every pick). |
| Phone died / browser closed | Everything is saved locally. Reopen and it's exactly where you left it. |

---

## The plan, in one paragraph

Rounds 1–2: best RB or WR by tier, no reaching. Rounds 3–6: keep building the
RB/WR core; a tier-1 or tier-2 TE is fine here if the value's there. Rounds 7–9:
take your QB. Rounds 10–13: depth and upside — grab at least one backup RB with a
path to starting, because RBs get hurt more than anyone. Last two or three
rounds: kicker and defense, and don't think about them for more than five
seconds. The engine already enforces all of this; the shortlist is the plan.

Priority is not finishing last, then finishing top half, then winning. That means
in rounds 1–4 you take the boring, obvious, clearly-the-starter guy over the
exciting one. The tool weights it that way on purpose.
