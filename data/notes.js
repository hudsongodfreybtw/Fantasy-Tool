/* =============================================================================
   notes.js — per-player news layer (doc Section 8c)
   Generated 2026-09-06 from a live news sweep, draft day.

   Tags: up | down | injury | watch | safe
   The engine weights injury/down roughly double in rounds 1-4, per the doc's
   "avoid unnecessary risk early" priority.
   ========================================================================== */

window.NOTES_DATA = {
  generated: '2026-09-06',
  notes: {
    // --- the two that actually change the draft --------------------------
    "Josh Jacobs":      { tag: 'injury', note: 'ON COMMISSIONER EXEMPT LIST — off the 53-man roster, no return date, ~6 games likely. Do not draft.' },
    "Malik Nabers":     { tag: 'injury', note: 'ACL + meniscus recovery, Week 1 status still unclear' },

    // --- flags worth seeing before you spend an early pick ----------------
    "Puka Nacua":       { tag: 'watch',  note: 'psoas healed and practising, but a league review is still open — small suspension risk' },
    "De'Von Achane":    { tag: 'watch',  note: 'new Miami offense under Malik Willis may siphon rushing work' },

    // --- risers -----------------------------------------------------------
    "MarShawn Lloyd":   { tag: 'up',     note: 'now the Green Bay lead back with Jacobs out — biggest riser on the board' },
    "Cam Skattebo":     { tag: 'up',     note: 'healthy, sharing top of the Giants depth chart, up to RB18' },
    "Bucky Irving":     { tag: 'up',     note: 'full speed after shoulder surgery, majority of Tampa Bay carries' },
    "Ashton Jeanty":    { tag: 'up',     note: 'Raiders offense expected to improve under Kubiak' },
    "Omarion Hampton":  { tag: 'up',     note: 'breakout buzz with McDaniel running the Chargers offense' },
    "Alec Pierce":      { tag: 'up',     note: 'biggest non-backfield riser, expanded Indianapolis role' },
    "Stefon Diggs":     { tag: 'up',     note: 'signed with Washington 8/7, immediate target share next to McLaurin' },
    "Garrett Wilson":   { tag: 'safe',   note: 'knee fully behind him, no limitations entering 2026' },

    // --- steady, high-confidence anchors ---------------------------------
    "Jahmyr Gibbs":     { tag: 'safe',   note: 'consensus 1.01, no injury flags' },
    "Bijan Robinson":   { tag: 'safe',   note: 'ADP 2.08, clean bill of health' },
    "Ja'Marr Chase":    { tag: 'safe',   note: 'first WR off the board, ADP 4.01' },
    "Jonathan Taylor":  { tag: 'safe',   note: 'ADP 5.37, clear lead back' },
    "James Cook":       { tag: 'safe',   note: '14 TDs last year, still the lead back next to Allen' },
    "Trey McBride":     { tag: 'safe',   note: '18.7 PPG last season, safest TE bet with Bowers' },
    "Brock Bowers":     { tag: 'safe',   note: 'healthy again after a lingering 2025 injury' },
    "Kyren Williams":   { tag: 'safe',   note: 'called one of the last clear RB1 bets' },
    "Tyrone Tracy Jr":  { tag: 'watch',  note: 'RB44 — splitting the Giants backfield with Skattebo' },
    "Kaleb Johnson":    { tag: 'watch',  note: 'traded to Green Bay, part of a committee behind Lloyd' }
  }
};
