/* =============================================================================
   state.js — the single source of truth for the app.
   Owns: settings, the pick log, the merged player pool, and every derived
   value the UI and engine read (available players, my roster, current pick).
   Everything persists to localStorage so a phone refresh mid-draft loses
   nothing.
   ========================================================================== */
(function (global) {
  'use strict';

  var K = {
    settings: 'ft.settings.v1',
    picks:    'ft.picks.v1',
    players:  'ft.sleeperPlayers.v1',
    ranks:    'ft.rankOverrides.v1',
    notes:    'ft.noteOverrides.v1',
    byes:     'ft.byeOverrides.v1'
  };

  var DEFAULT_SETTINGS = {
    leagueId: '1389737725439004672',
    draftId: null,
    username: 'hudgod',
    mySlot: 7,
    teams: 12,
    rounds: 16,
    autoSync: true,
    pollMs: 3000,
    pickTimerSec: 60,
    demoMode: false
  };

  var S = {
    settings: Object.assign({}, DEFAULT_SETTINGS, U.store.get(K.settings, {})),
    picks:    U.store.get(K.picks, []),           // [{pickNo, key, name, pos, team, slot, source}]
    sleeperPlayers: U.store.get(K.players, null), // {key: {name,pos,team,adp,id}}
    rankOverrides:  U.store.get(K.ranks, null),   // {key: {rank,tier,adp,pos,team,bye,name}}
    noteOverrides:  U.store.get(K.notes, null),   // {normName: {tag,note}}
    byeOverrides:   U.store.get(K.byes, {}),      // {TEAM: week}
    pool: [],
    poolByKey: {},
    listeners: []
  };

  function keyOf(name, pos) { return U.normName(name) + '|' + (pos || '').toUpperCase(); }

  function save() {
    U.store.set(K.settings, S.settings);
    U.store.set(K.picks, S.picks);
    U.store.set(K.byes, S.byeOverrides);
    if (S.rankOverrides) U.store.set(K.ranks, S.rankOverrides);
    if (S.noteOverrides) U.store.set(K.notes, S.noteOverrides);
  }
  function saveSleeperPlayers() { return U.store.set(K.players, S.sleeperPlayers); }

  function byeFor(team) {
    team = U.normTeam(team);
    if (!team) return null;
    if (S.byeOverrides[team] != null) return S.byeOverrides[team];
    var b = (window.BOARD_DATA && window.BOARD_DATA.byes) || {};
    return b[team] != null ? b[team] : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Pool = curated board  +  Sleeper player DB (if loaded)  +  overrides.
     Curated players keep their rank/tier; Sleeper-only players are appended
     below the board, ordered by Sleeper's search_rank (a usable ADP proxy).  */
  function rebuildPool() {
    var pool = [], byKey = {};
    var notes = notesMap();

    (window.BOARD_DATA.players || []).forEach(function (p) {
      var k = keyOf(p.name, p.pos);
      var o = { key: k, name: p.name, pos: p.pos, team: U.normTeam(p.team),
                tier: p.tier, rank: p.rank, adp: p.adp, source: 'board' };
      o.bye = byeFor(o.team);
      byKey[k] = o; pool.push(o);
    });

    // Merge Sleeper metadata: fills in team (and therefore bye) for the ~69
    // curated players the doc did not name a team for, and adds everyone else.
    var extras = [];
    if (S.sleeperPlayers) {
      Object.keys(S.sleeperPlayers).forEach(function (k) {
        var sp = S.sleeperPlayers[k];
        var cur = byKey[k];
        if (cur) {
          if (!cur.team && sp.team) { cur.team = U.normTeam(sp.team); cur.bye = byeFor(cur.team); }
          if (cur.adp == null && sp.adp != null) cur.adp = sp.adp;
          cur.sleeperId = sp.id;
        } else {
          extras.push({ key: k, name: sp.name, pos: sp.pos, team: U.normTeam(sp.team),
                        tier: null, adp: sp.adp, sleeperId: sp.id, source: 'sleeper' });
        }
      });
    }
    extras.sort(function (a, b) {
      var x = a.adp == null ? 9999 : a.adp, y = b.adp == null ? 9999 : b.adp;
      return x - y;
    });
    var next = pool.length + 1;
    extras.forEach(function (e) {
      e.rank = next++;
      e.bye = byeFor(e.team);
      byKey[e.key] = e; pool.push(e);
    });

    // Pasted rankings win over everything (freshest data).
    if (S.rankOverrides) {
      Object.keys(S.rankOverrides).forEach(function (k) {
        var ov = S.rankOverrides[k], cur = byKey[k];
        if (!cur) {
          cur = { key: k, name: ov.name, pos: ov.pos, team: U.normTeam(ov.team), source: 'paste' };
          byKey[k] = cur; pool.push(cur);
        }
        if (ov.rank != null) cur.rank = ov.rank;
        if (ov.tier != null) cur.tier = ov.tier;
        if (ov.adp  != null) cur.adp  = ov.adp;
        if (ov.team) { cur.team = U.normTeam(ov.team); }
        if (ov.bye != null) cur.bye = ov.bye; else cur.bye = byeFor(cur.team);
        cur.source = 'paste';
      });
      // A pasted list is usually a PARTIAL board (a top-50, say). Its ranks
      // would collide with the ranks already on the board, so treat the pasted
      // players as the top of the board and keep everyone else, in their
      // existing order, underneath.
      pool.sort(function (a, b) {
        var ao = S.rankOverrides[a.key] ? 0 : 1, bo = S.rankOverrides[b.key] ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.rank - b.rank;
      });
      pool.forEach(function (p, i) { p.rank = i + 1; });
    }

    // K / DEF placeholders so rounds 14-16 still get a recommendation before
    // the Sleeper DB is loaded. Removed as soon as real ones exist.
    ['K', 'DEF'].forEach(function (pos) {
      var has = pool.some(function (p) { return p.pos === pos; });
      if (has) return;
      var o = { key: '__placeholder__|' + pos, name: pos === 'K' ? 'Any starting kicker' : 'Any top-12 defense',
                pos: pos, team: null, tier: null, rank: pool.length + 1, adp: null,
                bye: null, placeholder: true, source: 'placeholder' };
      byKey[o.key] = o; pool.push(o);
    });

    pool.forEach(function (p) { p.note = notes[U.normName(p.name)] || null; });

    S.pool = pool; S.poolByKey = byKey;
    return pool;
  }

  function notesMap() {
    var base = (window.NOTES_DATA && window.NOTES_DATA.notes) || {};
    var out = {};
    Object.keys(base).forEach(function (n) { out[U.normName(n)] = base[n]; });
    if (S.noteOverrides) {
      Object.keys(S.noteOverrides).forEach(function (n) { out[U.normName(n)] = S.noteOverrides[n]; });
    }
    return out;
  }

  /* ---------------------------------------------------------------------- */
  /* Draft state                                                             */
  function takenKeys() {
    var t = {};
    S.picks.forEach(function (p) { if (p.key) t[p.key] = p; });
    return t;
  }

  function currentPickNo() {
    // The pick about to happen = highest recorded pick + 1 (picks may arrive
    // out of order from Sleeper, so use max, not length).
    var max = 0;
    S.picks.forEach(function (p) { if (p.pickNo > max) max = p.pickNo; });
    return max + 1;
  }

  function myPickNumbers() {
    var out = [];
    for (var r = 1; r <= S.settings.rounds; r++) {
      out.push(U.pickNumber(r, S.settings.mySlot, S.settings.teams));
    }
    return out;
  }

  function nextMyPick(fromPick) {
    var mine = myPickNumbers();
    for (var i = 0; i < mine.length; i++) if (mine[i] >= fromPick) return mine[i];
    return null;
  }

  function isMyTurn() {
    var pn = currentPickNo();
    if (pn > S.settings.teams * S.settings.rounds) return false;
    return U.slotOf(pn, S.settings.teams) === S.settings.mySlot;
  }

  function myPlayers() {
    var mine = [];
    S.picks.forEach(function (p) {
      if (p.slot === S.settings.mySlot && S.poolByKey[p.key]) mine.push(S.poolByKey[p.key]);
      else if (p.slot === S.settings.mySlot && p.key) {
        mine.push({ key: p.key, name: p.name, pos: p.pos, team: p.team, rank: 999, tier: null, bye: null });
      }
    });
    return mine;
  }

  function counts(players) {
    var c = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    (players || myPlayers()).forEach(function (p) { if (c[p.pos] != null) c[p.pos]++; });
    return c;
  }

  function available() {
    var t = takenKeys();
    return S.pool.filter(function (p) { return !t[p.key]; });
  }

  /* Build the context object the engine consumes. */
  function context() {
    var pickNo = currentPickNo();
    var teams = S.settings.teams;
    var mine = myPlayers();
    var next = nextMyPick(pickNo);
    var myTurn = isMyTurn();
    // If it's my turn, "next pick" for survival math is the following one.
    var nextForOutlook = myTurn ? nextMyPick(pickNo + 1) : next;
    return {
      pickNo: myTurn ? pickNo : (next || pickNo),
      round: U.roundOf(myTurn ? pickNo : (next || pickNo), teams),
      nextPickNo: nextForOutlook,
      myTurn: myTurn,
      picksUntilMine: next ? Math.max(0, next - pickNo) : null,
      counts: counts(mine),
      myPlayers: mine,
      available: available(),
      notes: notesMap()
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                               */
  function addPick(pick) {
    // pick: {pickNo, key, name, pos, team, slot, source, byName}
    var existing = S.picks.filter(function (p) { return p.pickNo === pick.pickNo; })[0];
    if (existing) {
      Object.assign(existing, pick);
    } else {
      // Guard against the same player being logged twice from two sources.
      var dupe = S.picks.filter(function (p) { return p.key && p.key === pick.key; })[0];
      if (dupe) { Object.assign(dupe, pick); }
      else S.picks.push(pick);
    }
    S.picks.sort(function (a, b) { return a.pickNo - b.pickNo; });
    save(); emit();
  }

  function markTaken(player, slot) {
    var pn = currentPickNo();
    addPick({
      pickNo: pn, key: player.key, name: player.name, pos: player.pos,
      team: player.team, slot: slot != null ? slot : U.slotOf(pn, S.settings.teams),
      source: 'manual'
    });
  }

  /* Someone drafted a player who is not on our board at all. We still have to
     advance the pick counter or every "is it my turn" calculation drifts. */
  function addUnknownPick(name) {
    var pn = currentPickNo();
    addPick({
      pickNo: pn, key: null, name: name || 'Unknown player', pos: null, team: null,
      slot: U.slotOf(pn, S.settings.teams), source: 'manual-unknown'
    });
  }

  /* Is the board deep enough to survive the rest of the draft? */
  function poolHealth() {
    var pn = currentPickNo();
    var picksLeft = (S.settings.teams * S.settings.rounds) - pn + 1;
    var left = available().filter(function (p) { return !p.placeholder; }).length;
    return {
      picksLeft: picksLeft, playersLeft: left,
      thin: left < picksLeft * 0.6,
      hasSleeperDB: !!S.sleeperPlayers
    };
  }

  function undoLastPick() {
    if (!S.picks.length) return;
    S.picks.pop(); save(); emit();
  }

  function removePick(pickNo) {
    S.picks = S.picks.filter(function (p) { return p.pickNo !== pickNo; });
    save(); emit();
  }

  function resetDraft() { S.picks = []; save(); emit(); }

  function setSettings(patch) {
    Object.assign(S.settings, patch); save(); emit();
  }

  function setSleeperPlayers(map) {
    S.sleeperPlayers = map;
    saveSleeperPlayers();
    rebuildPool(); emit();
  }

  function setRankOverrides(map) {
    S.rankOverrides = map; U.store.set(K.ranks, map);
    rebuildPool(); emit();
  }

  function setNoteOverrides(map) {
    S.noteOverrides = map; U.store.set(K.notes, map);
    rebuildPool(); emit();
  }

  function setByes(map) {
    Object.assign(S.byeOverrides, map); save();
    rebuildPool(); emit();
  }

  function findPlayerByName(name, pos) {
    var k = keyOf(name, pos);
    if (S.poolByKey[k]) return S.poolByKey[k];
    if (!pos) {   // positionless lookup
      var n = U.normName(name);
      for (var i = 0; i < S.pool.length; i++) if (U.normName(S.pool[i].name) === n) return S.pool[i];
    }
    return null;
  }

  function search(q, limit) {
    q = U.normName(q);
    if (!q) return [];
    var t = takenKeys(), out = [];
    for (var i = 0; i < S.pool.length && out.length < (limit || 25); i++) {
      var p = S.pool[i];
      if (U.normName(p.name).indexOf(q) >= 0) out.push({ player: p, taken: !!t[p.key] });
    }
    return out;
  }

  function on(fn) { S.listeners.push(fn); }
  function emit() { S.listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }

  global.State = {
    S: S, K: K, keyOf: keyOf, save: save, rebuildPool: rebuildPool,
    context: context, available: available, takenKeys: takenKeys,
    currentPickNo: currentPickNo, myPickNumbers: myPickNumbers,
    nextMyPick: nextMyPick, isMyTurn: isMyTurn, myPlayers: myPlayers, counts: counts,
    addPick: addPick, markTaken: markTaken, undoLastPick: undoLastPick,
    addUnknownPick: addUnknownPick, poolHealth: poolHealth,
    removePick: removePick, resetDraft: resetDraft, setSettings: setSettings,
    setSleeperPlayers: setSleeperPlayers, setRankOverrides: setRankOverrides,
    setNoteOverrides: setNoteOverrides, setByes: setByes,
    findPlayerByName: findPlayerByName, search: search, byeFor: byeFor,
    on: on, emit: emit
  };
})(window);
