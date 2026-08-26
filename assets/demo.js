/* =============================================================================
   demo.js — practice draft.
   -----------------------------------------------------------------------------
   Runs a fake 12-team draft against the real board and the real recommendation
   engine, so you can rehearse the actual rhythm of a live draft: the clock, the
   shortlist, tapping your pick, watching the board drain between turns.

   Your real draft state is backed up when practice starts and restored when it
   ends, so this can never eat a real pick. Live sync is paused for the duration.
   ========================================================================== */
(function (global) {
  'use strict';

  var BACKUP = 'ft.picksBackup.v1';
  var PICK_MS = 900;          // how fast the fake opponents pick

  var rosters = {};           // slot -> position counts, rebuilt each practice
  var timer = null;

  function freshRosters() {
    rosters = {};
    for (var s = 1; s <= State.S.settings.teams; s++) {
      rosters[s] = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    }
  }

  /* Opponents draft like ordinary league-mates: roughly by board order, RB/WR
     early, a QB somewhere in the middle, K and DEF at the very end, and a
     little randomness so it isn't the same draft every time. */
  function opponentPick(round, slot) {
    var c = rosters[slot] || (rosters[slot] = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });
    var avail = State.available().filter(function (p) { return !p.placeholder; });
    if (!avail.length) return null;

    var ok = avail.filter(function (p) {
      if (p.pos === 'K')   return round >= 14 && c.K < 1;
      if (p.pos === 'DEF') return round >= 13 && c.DEF < 1;
      if (p.pos === 'QB')  return (round >= 5 && c.QB < 1) || (round >= 12 && c.QB < 2);
      if (p.pos === 'TE')  return c.TE < 2;
      return c[p.pos] < 6;
    });
    if (!ok.length) ok = avail;
    ok.sort(function (a, b) { return a.rank - b.rank; });

    // Take one of the top few, not always the very top — real people reach.
    var span = Math.min(4, ok.length);
    var pick = ok[Math.floor(Math.random() * span)];
    c[pick.pos]++;
    return pick;
  }

  function step() {
    timer = null;
    if (!State.S.settings.demoMode) return;

    var st = State.S.settings;
    var pickNo = State.currentPickNo();
    if (pickNo > st.teams * st.rounds) return;              // draft finished
    if (U.slotOf(pickNo, st.teams) === st.mySlot) return;    // your turn: wait

    var round = U.roundOf(pickNo, st.teams);
    var slot = U.slotOf(pickNo, st.teams);
    var p = opponentPick(round, slot);
    if (!p) return;
    State.addPick({
      pickNo: pickNo, key: p.key, name: p.name, pos: p.pos, team: p.team,
      slot: slot, source: 'demo'
    });
    schedule();
  }

  function schedule() {
    if (!State.S.settings.demoMode || timer) return;
    var st = State.S.settings;
    var pickNo = State.currentPickNo();
    if (pickNo > st.teams * st.rounds) return;
    if (U.slotOf(pickNo, st.teams) === st.mySlot) return;
    timer = setTimeout(step, PICK_MS);
  }

  function start() {
    if (State.S.settings.demoMode) return;
    U.store.set(BACKUP, State.S.picks);
    Sleeper.stop();
    State.S.picks = [];
    freshRosters();
    State.setSettings({
      demoMode: true,
      autoSyncBeforeDemo: !!State.S.settings.autoSync,
      autoSync: false
    });
    schedule();
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    var restore = U.store.get(BACKUP, []);
    State.S.picks = Array.isArray(restore) ? restore : [];
    var wasOn = !!State.S.settings.autoSyncBeforeDemo;
    State.setSettings({ demoMode: false, autoSync: wasOn });
    U.store.del(BACKUP);
    if (wasOn && State.S.settings.draftId) Sleeper.start();
  }

  function isOn() { return !!State.S.settings.demoMode; }

  /* Whenever anything changes (including you making a pick), see whether the
     fake opponents should get moving again. */
  function attach() {
    State.on(schedule);
    if (isOn()) { freshRosters(); replayRosters(); schedule(); }
  }

  /* If the app was reloaded mid-practice, rebuild the fake teams' position
     counts from the picks already on the board. */
  function replayRosters() {
    State.S.picks.forEach(function (p) {
      if (!p.pos || !rosters[p.slot]) return;
      if (rosters[p.slot][p.pos] != null) rosters[p.slot][p.pos]++;
    });
  }

  global.Demo = { start: start, stop: stop, isOn: isOn, attach: attach, schedule: schedule };
})(window);
