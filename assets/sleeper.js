/* =============================================================================
   sleeper.js — live draft feed (doc Section 8a, the highest-impact feature)
   -----------------------------------------------------------------------------
   Sleeper's v1 API is public, read-only and needs no auth. Everything here runs
   in YOUR browser, talking straight to api.sleeper.app.

   Endpoints used:
     GET /v1/league/<league_id>            league metadata (sanity check)
     GET /v1/league/<league_id>/drafts     resolve the draft_id
     GET /v1/draft/<draft_id>              draft status, order, pick timer
     GET /v1/draft/<draft_id>/picks        THE feed - every pick, live
     GET /v1/user/<username>               resolve my user_id -> my draft slot
     GET /v1/players/nfl                   ~5MB dictionary, fetched at most once
                                           per day and cached (Sleeper asks for
                                           this explicitly)

   Polling at 3s = 20 requests/min, far below Sleeper's 1000/min ceiling.
   ========================================================================== */
(function (global) {
  'use strict';

  var BASE = 'https://api.sleeper.app/v1';

  var Sync = {
    status: 'idle',      // idle | connecting | live | error | done
    message: '',
    lastPollAt: null,
    lastError: null,
    draft: null,
    timer: null,
    consecutiveErrors: 0,
    listeners: []
  };

  function emit() { Sync.listeners.forEach(function (f) { try { f(Sync); } catch (e) {} }); }
  function on(fn) { Sync.listeners.push(fn); }
  function setStatus(st, msg) { Sync.status = st; Sync.message = msg || ''; emit(); }

  /* If direct browser calls are blocked (some corporate/campus wifi, or a
     CORS surprise), point this at the bundled server/proxy.mjs instead. */
  function base() {
    var p = State.S.settings.proxyBase;
    return p ? p.replace(/\/$/, '') + '/v1' : BASE;
  }

  function get(path, opts) {
    var url = base() + path;
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, (opts && opts.timeout) || 12000) : null;
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + path);
        return r.json();
      })
      .catch(function (e) {
        if (t) clearTimeout(t);
        // A CORS rejection and an offline phone look identical to fetch(); say so.
        if (e.name === 'AbortError') throw new Error('Timed out calling ' + path);
        if (e instanceof TypeError) {
          throw new Error('Could not reach api.sleeper.app (no network, or the ' +
                          'request was blocked). Manual mode still works.');
        }
        throw e;
      });
  }

  /* -------------------------------------------------------------------- */
  function getLeague(leagueId) { return get('/league/' + leagueId); }

  function getLeagueDrafts(leagueId) { return get('/league/' + leagueId + '/drafts'); }

  function getDraft(draftId) { return get('/draft/' + draftId); }

  function getPicks(draftId) { return get('/draft/' + draftId + '/picks'); }

  function getUser(username) { return get('/user/' + encodeURIComponent(username)); }

  /* Pick the draft we actually care about: newest season, newest start time. */
  function chooseDraft(drafts) {
    if (!drafts || !drafts.length) return null;
    return drafts.slice().sort(function (a, b) {
      var s = String(b.season || '').localeCompare(String(a.season || ''));
      if (s !== 0) return s;
      return (b.start_time || b.created || 0) - (a.start_time || a.created || 0);
    })[0];
  }

  /* Resolve draft id (and my slot, if we can) from the league id. */
  function connect() {
    var st = State.S.settings;
    setStatus('connecting', 'Resolving draft...');
    return getLeagueDrafts(st.leagueId)
      .then(function (drafts) {
        var d = chooseDraft(drafts);
        if (!d) throw new Error('No draft exists for this league yet. Sleeper only ' +
                                'creates it once the commissioner sets the draft up.');
        Sync.draft = d;
        State.setSettings({ draftId: d.draft_id });
        if (d.settings && d.settings.pick_timer) {
          State.setSettings({ pickTimerSec: d.settings.pick_timer });
        }
        if (d.settings && d.settings.teams) State.setSettings({ teams: d.settings.teams });
        if (d.settings && d.settings.rounds) State.setSettings({ rounds: d.settings.rounds });
        return detectMySlot(d);
      })
      .then(function () { return poll(); })
      .then(function () {
        setStatus('live', 'Connected');
        return Sync.draft;
      })
      .catch(function (e) {
        Sync.lastError = e.message;
        setStatus('error', e.message);
        throw e;
      });
  }

  /* Match my Sleeper username to a draft slot so "is it my turn" is automatic. */
  function detectMySlot(draft) {
    var uname = State.S.settings.username;
    if (!uname || !draft || !draft.draft_order) return Promise.resolve(null);
    return getUser(uname).then(function (u) {
      if (!u || !u.user_id) return null;
      var slot = draft.draft_order[u.user_id];
      if (slot) {
        State.setSettings({ mySlot: slot, myUserId: u.user_id, slotAutoDetected: true });
      }
      return slot;
    }).catch(function () { return null; });   // never block the draft on this
  }

  /* Map a Sleeper pick to a board player. Name+position, with team as a
     tiebreak — Sleeper gives us all three on every pick.                    */
  function pickToPlayer(p) {
    var m = p.metadata || {};
    var pos = (m.position || '').toUpperCase();
    var team = U.normTeam(m.team);
    var name;
    if (pos === 'DEF') name = (team || m.last_name || '') + ' D/ST';
    else name = ((m.first_name || '') + ' ' + (m.last_name || '')).trim();
    return { name: name, pos: pos, team: team, sleeperId: p.player_id };
  }

  /* One poll: fetch picks, fold anything new into state. */
  function poll() {
    var draftId = State.S.settings.draftId;
    if (!draftId) return Promise.reject(new Error('No draft id yet — hit Connect.'));
    return getPicks(draftId).then(function (picks) {
      Sync.lastPollAt = Date.now();
      Sync.consecutiveErrors = 0;
      var known = {};
      State.S.picks.forEach(function (p) { if (p.source === 'sleeper') known[p.pickNo] = true; });
      var added = 0;
      (picks || []).forEach(function (p) {
        var pickNo = p.pick_no;
        if (!pickNo || known[pickNo]) return;
        var info = pickToPlayer(p);
        var boardPlayer = State.findPlayerByName(info.name, info.pos);
        State.addPick({
          pickNo: pickNo,
          key: boardPlayer ? boardPlayer.key : State.keyOf(info.name, info.pos),
          name: info.name, pos: info.pos, team: info.team,
          slot: p.draft_slot || U.slotOf(pickNo, State.S.settings.teams),
          rosterId: p.roster_id, source: 'sleeper',
          onBoard: !!boardPlayer
        });
        added++;
      });
      if (Sync.status !== 'live') setStatus('live', 'Connected');
      return added;
    }).catch(function (e) {
      Sync.consecutiveErrors++;
      Sync.lastError = e.message;
      setStatus('error', e.message);
      throw e;
    });
  }

  function start() {
    stop();
    var tick = function () {
      poll().catch(function () { /* status already reflects it */ })
        .then(function () {
          // Back off on repeated failure so a dead network doesn't hammer.
          var wait = State.S.settings.pollMs;
          if (Sync.consecutiveErrors > 2) wait = Math.min(30000, wait * Sync.consecutiveErrors);
          Sync.timer = setTimeout(tick, wait);
        });
    };
    tick();
  }

  function stop() { if (Sync.timer) { clearTimeout(Sync.timer); Sync.timer = null; } }

  /* ---------------------------------------------------------------------- */
  /* Player dictionary. Big (~5MB) so: fetch once, filter hard, cache.       */
  var FANTASY_POS = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1 };

  function loadPlayers(onProgress) {
    if (onProgress) onProgress('Downloading player list (~5MB, one time)...');
    return get('/players/nfl', { timeout: 90000 }).then(function (all) {
      if (onProgress) onProgress('Filtering to fantasy-relevant players...');
      var out = {}, n = 0;
      Object.keys(all).forEach(function (id) {
        var p = all[id];
        if (!p) return;
        var pos = (p.position || '').toUpperCase();
        if (!FANTASY_POS[pos]) return;
        // Keep DEF always; for skill players require an active NFL team.
        var team = U.normTeam(p.team);
        if (pos !== 'DEF') {
          if (!team) return;
          if (p.status && /inactive|retired/i.test(p.status) && !p.search_rank) return;
        }
        var name = pos === 'DEF'
          ? (team || id) + ' D/ST'
          : ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        if (!name) return;
        // search_rank is Sleeper's own popularity/ADP-ish ordering. 9999999 =
        // "irrelevant", so drop those to keep the cache small.
        var sr = p.search_rank;
        if (sr == null || sr > 900) { if (pos !== 'DEF') return; sr = null; }
        out[State.keyOf(name, pos)] = {
          id: id, name: name, pos: pos, team: team,
          adp: sr, injury: p.injury_status || null
        };
        n++;
      });
      var ok = State.setSleeperPlayers(out) !== false;
      U.store.set('ft.playersLoadedAt', Date.now());
      if (onProgress) onProgress('Loaded ' + n + ' players.');
      return n;
    });
  }

  function playersLoadedAt() { return U.store.get('ft.playersLoadedAt', null); }

  /* A single button that tells you exactly what is and is not working. */
  function diagnose() {
    var out = [];
    return getLeague(State.S.settings.leagueId)
      .then(function (l) {
        out.push({ ok: true, text: 'League reachable: "' + (l.name || l.league_id) + '" (' +
                                   (l.total_rosters || '?') + ' teams, ' + (l.season || '?') + ')' });
        return getLeagueDrafts(State.S.settings.leagueId);
      })
      .then(function (drafts) {
        var d = chooseDraft(drafts);
        if (!d) { out.push({ ok: false, text: 'No draft created in this league yet.' }); return null; }
        out.push({ ok: true, text: 'Draft found: ' + d.draft_id + ' (status: ' + d.status + ')' });
        return getPicks(d.draft_id).then(function (picks) {
          out.push({ ok: true, text: 'Pick feed works — ' + (picks || []).length + ' picks so far.' });
        });
      })
      .then(function () { return out; })
      .catch(function (e) {
        out.push({ ok: false, text: e.message });
        out.push({ ok: false, text: 'Fallback: switch off Auto-sync and mark picks by hand on the Board tab.' });
        return out;
      });
  }

  global.Sleeper = {
    Sync: Sync, on: on, connect: connect, poll: poll, start: start, stop: stop,
    loadPlayers: loadPlayers, playersLoadedAt: playersLoadedAt, diagnose: diagnose,
    getLeague: getLeague, getDraft: getDraft, getPicks: getPicks,
    pickToPlayer: pickToPlayer, chooseDraft: chooseDraft
  };
})(window);
