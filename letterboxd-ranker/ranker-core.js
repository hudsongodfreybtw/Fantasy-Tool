/*
 * Reelsort core: pairwise "better or worse" ranking of watched films,
 * turned into half-star ratings. No DOM access here, so it runs in the
 * browser (window.RankerCore) and in Node tests (module.exports).
 *
 * Model
 *   ranked  – film ids ordered best → worst. Films you already rated on
 *             Letterboxd ("anchors") start here, sorted by their stars.
 *   queue   – unrated films still waiting to be placed.
 *   cur     – the film being placed: a binary search over insertion
 *             positions [lo, hi] in `ranked`.
 *
 * Each answer halves the window. The search stops early once every
 * remaining position would give the same star rating (for example, the
 * window sits entirely between two 4-star anchors), so you are never
 * asked to split hairs that cannot change the result.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RankerCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MIN_STAR = 0.5;
  var MAX_STAR = 5;

  // Used only when there are no rated films to anchor against: a typical
  // Letterboxd-ish spread (percent of films at 0.5, 1, … 5 stars).
  var DEFAULT_SPREAD = [1, 2, 3, 5, 9, 14, 20, 20, 15, 11];

  /* ---------------------------------------------------------------- CSV */

  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, j) { o[h] = (r[j] || "").trim(); });
      return o;
    });
  }

  function csvField(v) {
    var s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ------------------------------------------------------------ Import */

  function filmKey(name, year) {
    return String(name || "").trim().toLowerCase() + "|" + String(year || "").trim();
  }

  /**
   * Build the film library from Letterboxd export rows.
   * watchedRows: watched.csv (Date, Name, Year, Letterboxd URI)
   * ratingsRows: ratings.csv (Date, Name, Year, Letterboxd URI, Rating)
   * Returns { films: {id: film}, order: [ids, most recently logged first] }.
   */
  function buildLibrary(watchedRows, ratingsRows) {
    var films = {};
    var seq = 0;
    function upsert(r) {
      var name = r.Name || r.Title || r.Film;
      if (!name) return null;
      var key = filmKey(name, r.Year);
      if (!films[key]) {
        films[key] = {
          id: "f" + (seq++).toString(36),
          t: name,
          y: r.Year ? String(r.Year) : "",
          u: r["Letterboxd URI"] || "",
          d: r.Date || "",
          r: null
        };
      }
      var f = films[key];
      if (r.Date && r.Date > f.d) f.d = r.Date;
      if (!f.u && r["Letterboxd URI"]) f.u = r["Letterboxd URI"];
      return f;
    }
    (watchedRows || []).forEach(upsert);
    (ratingsRows || []).forEach(function (r) {
      var f = upsert(r);
      var stars = parseFloat(r.Rating);
      if (f && stars >= MIN_STAR && stars <= MAX_STAR) f.r = Math.round(stars * 2) / 2;
    });
    var byId = {};
    var list = Object.keys(films).map(function (k) { return films[k]; });
    list.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
    var order = list.map(function (f) { byId[f.id] = f; return f.id; });
    return { films: byId, order: order };
  }

  /* ------------------------------------------------------------- State */

  function createState(library, opts) {
    opts = opts || {};
    var films = library.films;
    var anchors = library.order.filter(function (id) { return films[id].r != null; });
    // Stable sort by rating, best first.
    anchors = anchors
      .map(function (id, i) { return { id: id, i: i }; })
      .sort(function (a, b) { return films[b.id].r - films[a.id].r || a.i - b.i; })
      .map(function (x) { return x.id; });
    var state = {
      v: 1,
      films: films,
      ranked: anchors,
      queue: library.order.filter(function (id) { return films[id].r == null; }),
      skipped: [],
      excluded: [],
      ties: {},
      cur: null,
      comparisons: 0,
      sample: !!opts.sample,
      source: opts.source || ""
    };
    advance(state);
    return state;
  }

  function isAnchor(state, id) {
    return state.films[id] && state.films[id].r != null;
  }

  function nearestAnchorRating(state, from, step) {
    for (var i = from; i >= 0 && i < state.ranked.length; i += step) {
      var f = state.films[state.ranked[i]];
      if (f.r != null) return f.r;
    }
    return null;
  }

  function insertAt(state, id, pos) {
    state.ranked.splice(pos, 0, id);
    state.cur = null;
  }

  // Finish the current search if the answer can no longer change, then
  // start the next queued film. Loops until a real question is pending.
  function advance(state) {
    for (;;) {
      if (!state.cur) {
        if (!state.queue.length) return;
        var id = state.queue.shift();
        if (!state.ranked.length) { state.ranked.push(id); continue; }
        state.cur = { id: id, lo: 0, hi: state.ranked.length };
      }
      var c = state.cur;
      if (c.lo >= c.hi) { insertAt(state, c.id, c.lo); continue; }
      if (c.lo > 0 && c.hi < state.ranked.length) {
        var above = nearestAnchorRating(state, c.lo - 1, -1);
        var below = nearestAnchorRating(state, c.hi, 1);
        // Every film between the two bounding anchors gets the same stars
        // when the anchors agree, so further questions are pointless.
        if (above != null && below != null && above === below) {
          insertAt(state, c.id, (c.lo + c.hi) >> 1);
          continue;
        }
      }
      return;
    }
  }

  /** The pending question, or null when everything queued is placed. */
  function currentPair(state) {
    var c = state.cur;
    if (!c) return null;
    var mid = (c.lo + c.hi) >> 1;
    return {
      film: state.films[c.id],
      opponent: state.films[state.ranked[mid]],
      opponentRank: mid + 1,
      window: c.hi - c.lo
    };
  }

  /** verdict: "better" | "worse" | "tie" (the film being placed vs the opponent). */
  function answer(state, verdict) {
    var c = state.cur;
    if (!c) return state;
    var mid = (c.lo + c.hi) >> 1;
    state.comparisons++;
    if (verdict === "better") c.hi = mid;
    else if (verdict === "worse") c.lo = mid + 1;
    else if (verdict === "tie") {
      state.ties[c.id] = state.ranked[mid];
      insertAt(state, c.id, mid + 1);
    } else throw new Error("Unknown verdict: " + verdict);
    advance(state);
    return state;
  }

  /** Put the current film aside to rank later. */
  function skip(state) {
    if (!state.cur) return state;
    state.skipped.push(state.cur.id);
    state.cur = null;
    advance(state);
    return state;
  }

  /** Drop the current film entirely (e.g. you don't remember it). */
  function exclude(state) {
    if (!state.cur) return state;
    state.excluded.push(state.cur.id);
    state.cur = null;
    advance(state);
    return state;
  }

  function requeueSkipped(state) {
    state.queue = state.queue.concat(state.skipped);
    state.skipped = [];
    advance(state);
    return state;
  }

  /** Pull a placed unrated film back out and rank it again next. */
  function rerank(state, id) {
    if (isAnchor(state, id)) return state;
    var i = state.ranked.indexOf(id);
    if (i !== -1) state.ranked.splice(i, 1);
    ["skipped", "excluded", "queue"].forEach(function (k) {
      state[k] = state[k].filter(function (x) { return x !== id; });
    });
    delete state.ties[id];
    Object.keys(state.ties).forEach(function (k) { if (state.ties[k] === id) delete state.ties[k]; });
    if (state.cur) {
      // Restart the in-progress search: positions may have shifted.
      state.queue.unshift(state.cur.id);
      state.cur = null;
    }
    state.queue.unshift(id);
    advance(state);
    return state;
  }

  /* ------------------------------------------------------------- Stars */

  function roundHalf(x) {
    return Math.min(MAX_STAR, Math.max(MIN_STAR, Math.round(x * 2) / 2));
  }

  /**
   * Stars for every ranked film: { id: { stars, derived } }.
   * Anchors keep their Letterboxd rating. Each run of unrated films is
   * spread evenly across the gap between the anchors around it (5★ above
   * the best anchor, ½★ below the worst). With no anchors at all, stars
   * follow DEFAULT_SPREAD by rank percentile.
   */
  function computeStars(state) {
    var out = {};
    var ranked = state.ranked;
    var n = ranked.length;
    var hasAnchor = ranked.some(function (id) { return isAnchor(state, id); });

    if (!hasAnchor) {
      var cum = [];
      var total = 0;
      for (var s = DEFAULT_SPREAD.length - 1; s >= 0; s--) {
        total += DEFAULT_SPREAD[s];
        cum.push({ stars: (s + 1) / 2, upTo: total });
      }
      ranked.forEach(function (id, i) {
        var pct = ((i + 0.5) / n) * total;
        var bucket = cum.find(function (b) { return pct <= b.upTo; }) || cum[cum.length - 1];
        out[id] = { stars: bucket.stars, derived: true };
      });
    } else {
      var i = 0;
      var prevRating = MAX_STAR;
      while (i < n) {
        var id = ranked[i];
        if (isAnchor(state, id)) {
          prevRating = state.films[id].r;
          out[id] = { stars: prevRating, derived: false };
          i++;
          continue;
        }
        var j = i;
        while (j < n && !isAnchor(state, ranked[j])) j++;
        var hi = prevRating;
        var lo = j < n ? state.films[ranked[j]].r : MIN_STAR;
        var k = j - i;
        for (var m = 0; m < k; m++) {
          var v = hi - ((m + 1) / (k + 1)) * (hi - lo);
          out[ranked[i + m]] = { stars: roundHalf(v), derived: true };
        }
        i = j;
      }
    }

    // "Too close to call" answers share their opponent's stars.
    Object.keys(state.ties || {}).forEach(function (id) {
      if (!out[id]) return;
      var target = state.ties[id];
      var guard = 0;
      while (state.ties[target] && guard++ < 50) target = state.ties[target];
      if (out[target]) out[id] = { stars: out[target].stars, derived: true };
    });
    return out;
  }

  /* --------------------------------------------------------- Progress */

  function progress(state) {
    var unratedTotal = 0;
    Object.keys(state.films).forEach(function (id) { if (!isAnchor(state, id)) unratedTotal++; });
    var placed = state.ranked.filter(function (id) { return !isAnchor(state, id); }).length;
    var remaining = state.queue.length + (state.cur ? 1 : 0);
    var perFilm = Math.ceil(Math.log2(state.ranked.length + 2));
    var current = state.cur ? Math.ceil(Math.log2(state.cur.hi - state.cur.lo + 1)) : 0;
    return {
      unratedTotal: unratedTotal,
      placed: placed,
      remaining: remaining,
      skipped: state.skipped.length,
      excluded: state.excluded.length,
      anchors: state.ranked.length - placed,
      comparisons: state.comparisons,
      questionsLeftThisFilm: current,
      questionsLeftEstimate: current + state.queue.length * perFilm
    };
  }

  /* ------------------------------------------------------------ Export */

  /**
   * Letterboxd import CSV for films whose stars were derived here.
   * Columns follow Letterboxd's importer: LetterboxdURI, Title, Year, Rating.
   */
  function exportCSV(state, opts) {
    opts = opts || {};
    var stars = computeStars(state);
    var lines = ["LetterboxdURI,Title,Year,Rating"];
    state.ranked.forEach(function (id) {
      var s = stars[id];
      if (!s || (!s.derived && !opts.includeAnchors)) return;
      var f = state.films[id];
      lines.push([f.u, f.t, f.y, s.stars].map(csvField).join(","));
    });
    return lines.join("\n") + "\n";
  }

  /* --------------------------------------------------------- Snapshots */

  // Films never change after import, so undo snapshots skip them.
  function snapshot(state) {
    return JSON.stringify({
      ranked: state.ranked, queue: state.queue, skipped: state.skipped,
      excluded: state.excluded, ties: state.ties, cur: state.cur,
      comparisons: state.comparisons
    });
  }

  function restore(state, snap) {
    var s = JSON.parse(snap);
    Object.keys(s).forEach(function (k) { state[k] = s[k]; });
    return state;
  }

  return {
    MIN_STAR: MIN_STAR,
    MAX_STAR: MAX_STAR,
    parseCSV: parseCSV,
    buildLibrary: buildLibrary,
    createState: createState,
    currentPair: currentPair,
    answer: answer,
    skip: skip,
    exclude: exclude,
    requeueSkipped: requeueSkipped,
    rerank: rerank,
    computeStars: computeStars,
    progress: progress,
    exportCSV: exportCSV,
    snapshot: snapshot,
    restore: restore,
    isAnchor: isAnchor
  };
});
