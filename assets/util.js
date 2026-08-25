/* util.js — name normalization, storage, small helpers. Classic script (no
   modules) so index.html also works when opened directly from file://       */
(function (global) {
  'use strict';

  var SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

  /* Normalize a player name for cross-source matching:
     "Ja'Marr Chase" / "JaMarr Chase"  -> "jamarr chase"
     "Marvin Harrison Jr." -> "marvin harrison"                              */
  function normName(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[.'`’]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(SUFFIXES, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Sleeper uses a few team abbreviations that differ from common usage. */
  var TEAM_FIX = { JAX: 'JAC', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
  function normTeam(t) {
    if (!t) return null;
    t = String(t).toUpperCase().trim();
    return TEAM_FIX[t] || t;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* localStorage that never throws (private mode, quota, etc.) */
  var store = {
    get: function (k, fallback) {
      try {
        var raw = localStorage.getItem(k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function fmtClock(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Snake draft math. slot and round are 1-based. */
  function pickNumber(round, slot, teams) {
    return (round % 2 === 1)
      ? (round - 1) * teams + slot
      : (round - 1) * teams + (teams - slot + 1);
  }
  function roundOf(pickNo, teams) { return Math.floor((pickNo - 1) / teams) + 1; }
  function slotOf(pickNo, teams) {
    var r = roundOf(pickNo, teams);
    var idx = ((pickNo - 1) % teams) + 1;
    return (r % 2 === 1) ? idx : (teams - idx + 1);
  }

  global.U = {
    normName: normName, normTeam: normTeam, clamp: clamp, byId: byId, el: el,
    store: store, fmtClock: fmtClock,
    pickNumber: pickNumber, roundOf: roundOf, slotOf: slotOf
  };
})(window);
