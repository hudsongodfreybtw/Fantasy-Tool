/* =============================================================================
   notes.js — per-player enrichment layer (doc Section 8c)
   -----------------------------------------------------------------------------
   This is the "information your friends' spreadsheets don't have" layer:
   injury / depth-chart / practice-report signal for the top ~150-200 players,
   collapsed into one short line each.

   HOW TO REFRESH (do this on 9/5 or the morning of 9/6, NOT during the draft):
     Open Claude Code in this repo and say:
       "Run the last30days skill on the top 150 players in data/board.js for
        injury, depth-chart and preseason-role news, then rewrite data/notes.js"
     Or paste notes straight into the app: Draft tab -> "Paste player notes",
     one per line, in the form:   Player Name | tag | note text
     Tags: up (trending up), down (trending down), injury, watch, safe.

   Empty by default — an empty notes layer changes no recommendation, which is
   the correct behaviour for stale/unknown information.
   ========================================================================== */

window.NOTES_DATA = {
  generated: null,           // ISO date of the last enrichment pass
  // "player name": { tag: 'up'|'down'|'injury'|'watch'|'safe', note: '...' }
  notes: {}
};
