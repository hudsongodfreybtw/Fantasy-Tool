/* =============================================================================
   ui.js — rendering. Everything re-renders from State; nothing here holds
   draft truth of its own.
   ========================================================================== */
(function (global) {
  'use strict';

  var el = U.el, byId = U.byId;
  var view = 'now';
  var expanded = {};          // rec card key -> bool
  var boardFilter = 'ALL';
  var boardQuery = '';
  var boardLimit = 120;

  /* ---------------------------------------------------------------- sheet */
  var Sheet = {
    open: function (opts) {
      byId('sheetTitle').textContent = opts.title || '';
      var c = byId('sheetContent');
      c.innerHTML = '';
      if (opts.sub) c.appendChild(el('div', 'sheet-sub', opts.sub));
      if (opts.node) c.appendChild(opts.node);
      (opts.options || []).forEach(function (o) {
        var b = el('button', 'opt' + (o.cls ? ' ' + o.cls : ''), o.label);
        b.type = 'button';
        b.addEventListener('click', function () { Sheet.close(); o.onClick && o.onClick(); });
        c.appendChild(b);
      });
      byId('sheet').hidden = false;
    },
    close: function () { byId('sheet').hidden = true; }
  };

  /* --------------------------------------------------------------- pieces */
  function posChip(pos) { return el('span', 'pos ' + pos, pos); }

  /* "Amon-Ra St. Brown" -> "St. Brown", "Jaxon Smith-Njigba" -> "Smith-Njigba" */
  var PARTICLE = /^(st\.?|van|von|de|del|la|le|da|di)$/i;
  var SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  function lastName(full) {
    var t = String(full).trim().split(/\s+/).filter(function (x) { return !SUFFIX.test(x); });
    if (t.length <= 1) return String(full);
    var last = t[t.length - 1];
    if (/^d\/st$/i.test(last)) return String(full);          // "PHI D/ST"
    if (PARTICLE.test(t[t.length - 2])) return t[t.length - 2] + ' ' + last;
    return last;
  }

  function playerMeta(p) {
    var box = el('div', 'rec-meta');
    box.appendChild(posChip(p.pos));
    if (p.team) box.appendChild(el('span', null, p.team));
    if (p.bye != null) box.appendChild(el('span', null, 'bye ' + p.bye));
    if (p.tier != null) box.appendChild(el('span', 'tierchip', 'Tier ' + p.tier));
    box.appendChild(el('span', 'tierchip', '#' + p.rank));
    return box;
  }

  function noteBadge(note) {
    if (!note || !note.tag) return null;
    var cls = (note.tag === 'up' || note.tag === 'safe') ? 'up'
            : (note.tag === 'injury' || note.tag === 'down') ? 'flag' : 'reach';
    var label = { up: '↑ trending', down: '↓ trending', injury: '⚠ injury',
                  watch: '? watch', safe: '✓ locked in' }[note.tag] || note.tag;
    return el('span', 'badge ' + cls, label);
  }

  /* ------------------------------------------------------------- top bar */
  function renderTopbar(ctx) {
    var st = State.S.settings, sync = Sleeper.Sync;
    var dot = byId('syncDot'), label = byId('syncLabel');
    if (Demo.isOn()) {
      dot.className = 'dot conn';
      label.textContent = 'Practice';
    } else {
      dot.className = 'dot' + (sync.status === 'live' ? ' live'
        : sync.status === 'error' ? ' err'
        : sync.status === 'connecting' ? ' conn' : '');
      label.textContent = sync.status === 'live' ? 'Live'
        : sync.status === 'connecting' ? 'Connecting'
        : sync.status === 'error' ? 'Sync error' : 'Manual';
    }

    var pn = State.currentPickNo();
    var total = st.teams * st.rounds;
    var done = pn > total;
    byId('roundLabel').textContent = done ? 'Draft over' : 'Round ' + U.roundOf(pn, st.teams);
    byId('pickLabel').textContent = done ? '' : 'Pick ' + pn;

    var turn = byId('turnBox'), txt = byId('turnText');
    turn.className = 'turn';
    if (done) { txt.textContent = ''; return; }
    if (ctx.myTurn) { turn.classList.add('mine'); txt.textContent = 'YOUR PICK'; }
    else {
      var away = ctx.picksUntilMine;
      if (away == null) { txt.textContent = 'no picks left'; }
      else {
        if (away <= 2) turn.classList.add('soon');
        txt.textContent = away + (away === 1 ? ' pick away' : ' picks away');
      }
    }
  }

  /* ------------------------------------------------------------- banner */
  function renderBanner() {
    var b = byId('banner');
    var health = State.poolHealth();
    var msgs = [];
    if (Demo.isOn()) {
      b.hidden = false;
      b.className = 'banner';
      b.textContent = 'PRACTICE DRAFT — these picks are not real. ' +
        'Draft tab → “Stop practice” puts your real draft back.';
      return;
    }
    if (!health.hasSleeperDB && health.thin) {
      msgs.push({ bad: false, t: 'Only ' + health.playersLeft + ' players left on the board for ' +
        health.picksLeft + ' remaining picks. Draft tab → “Load Sleeper player DB” to fill it out.' });
    }
    if (Sleeper.Sync.status === 'error') {
      msgs.push({ bad: true, t: 'Live sync: ' + Sleeper.Sync.message + ' You can keep marking picks by hand.' });
    }
    if (!msgs.length) { b.hidden = true; return; }
    b.hidden = false;
    b.className = 'banner' + (msgs[0].bad ? ' bad' : '');
    b.textContent = msgs[0].t;
  }

  /* ---------------------------------------------------------------- NOW */
  function renderNow(ctx) {
    renderClock(ctx);

    var w = byId('warnings');
    w.innerHTML = '';
    Engine.warnings(ctx).forEach(function (x) {
      w.appendChild(el('div', 'warn-item' + (x.level === 'bad' ? ' bad' : x.level === 'info' ? ' info' : ''), x.text));
    });

    var st = State.S.settings;
    byId('recContext').textContent = ctx.myTurn
      ? 'round ' + ctx.round + ', pick ' + ctx.pickNo
      : 'preview for your pick at ' + ctx.pickNo + ' (round ' + ctx.round + ')';

    var list = byId('recList');
    list.innerHTML = '';
    var rec = ctx.available.length ? Engine.recommend(ctx, 5) : { top: [] };
    if (!rec.top.length) {
      list.appendChild(el('div', 'empty',
        'Nothing left worth recommending — every player on your board is drafted, ' +
        'and the slots you still could fill are already full.\n\n' +
        'Draft tab → “Load Sleeper player DB” pulls in every remaining NFL player.'));
    } else {
      rec.top.forEach(function (r, i) { list.appendChild(recCard(r, i, ctx)); });
    }

    byId('nextPickInline').textContent = ctx.nextPickNo ? 'pick ' + ctx.nextPickNo : 'your next pick';
    var ol = Engine.outlook(ctx, 6);
    fillMini(byId('goneList'), ol.gone, 'Nothing obvious');
    fillMini(byId('surviveList'), ol.surviving, 'Board is thin');
  }

  function fillMini(ul, rows, emptyText) {
    ul.innerHTML = '';
    if (!rows.length) { ul.appendChild(el('li', null, emptyText)); return; }
    rows.forEach(function (r) {
      var li = el('li');
      li.appendChild(posChip(r.player.pos));
      li.appendChild(el('span', 'nm', r.player.name));
      ul.appendChild(li);
    });
  }

  function recCard(r, i, ctx) {
    var p = r.player;
    var card = el('div', 'rec' + (i === 0 ? ' top' : ''));
    var main = el('button', 'rec-main'); main.type = 'button';
    main.appendChild(el('div', 'rec-num', String(i + 1)));

    var body = el('div', 'rec-body');
    body.appendChild(el('div', 'rec-name', p.name));
    var meta = playerMeta(p);
    if (r.adpDelta >= 10) meta.appendChild(el('span', 'badge value', 'VALUE'));
    else if (r.adpDelta <= -14) meta.appendChild(el('span', 'badge reach', 'REACH'));
    var nb = noteBadge(r.note); if (nb) meta.appendChild(nb);
    body.appendChild(meta);
    body.appendChild(el('div', 'rec-why', r.why));
    main.appendChild(body);
    main.appendChild(el('div', 'rec-chev', expanded[p.key] ? '▲' : '▼'));
    main.addEventListener('click', function () {
      expanded[p.key] = !expanded[p.key];
      render();
    });
    card.appendChild(main);

    if (expanded[p.key]) card.appendChild(recDetail(r, ctx));

    var take = el('button', 'rec-take', 'I drafted ' + lastName(p.name));
    take.type = 'button';
    take.addEventListener('click', function () { State.markTaken(p, State.S.settings.mySlot); });
    card.appendChild(take);
    return card;
  }

  function recDetail(r, ctx) {
    var d = el('div', 'rec-detail');
    var t = el('table'), rows = [];
    var f = {}; r.factors.forEach(function (x) { f[x.k] = x; });

    rows.push(['Board rank', '#' + r.player.rank + (r.player.tier != null ? ' (tier ' + r.player.tier + ')' : '')]);
    if (r.player.adp != null) rows.push(['ADP', '#' + Math.round(r.player.adp)]);
    if (ctx.nextPickNo) rows.push(['Still there at ' + ctx.nextPickNo + '?', Math.round(r.pSurvive * 100) + '%']);
    rows.push(['Left in his tier', String(r.tierLeft)]);
    rows.push(['Roster fit', pct(f.need.mult * f.depth.mult)]);
    rows.push(['Round strategy', pct(f.round.mult * (f.must ? f.must.mult : 1))]);
    if (f.bye.why) rows.push(['Bye clash', f.bye.why]);
    if (f.note && f.note.why) rows.push(['News', f.note.why]);

    rows.forEach(function (kv) {
      var tr = el('tr');
      tr.appendChild(el('td', null, kv[0]));
      tr.appendChild(el('td', null, kv[1]));
      t.appendChild(tr);
    });
    d.appendChild(t);
    return d;
  }

  function pct(mult) {
    var v = Math.round((mult - 1) * 100);
    return (v > 0 ? '+' : '') + v + '%';
  }

  /* ---------------------------------------------------------------- clock */
  function renderClock(ctx) {
    var card = byId('clockCard'), main = byId('clockMain'), sub = byId('clockSub');
    var st = State.S.settings;
    var pn = State.currentPickNo();
    card.className = 'clockcard';

    if (pn > st.teams * st.rounds) {
      main.textContent = 'Draft complete';
      sub.textContent = 'Check the Roster tab for your team.';
      return;
    }
    if (ctx.myTurn) {
      card.classList.add('mine');
      var left = secondsLeft();
      if (left != null) {
        if (left <= 15) card.classList.add('urgent');
        main.innerHTML = "You're on the clock — <span class='cd'>" + U.fmtClock(left) + '</span>';
      } else {
        main.textContent = "You're on the clock";
      }
      sub.textContent = 'Round ' + ctx.round + ', pick ' + ctx.pickNo + '. Take the top card.';
    } else {
      var away = ctx.picksUntilMine;
      main.textContent = away == null ? 'No picks left'
        : away + (away === 1 ? ' pick until you' : ' picks until you');
      sub.textContent = ctx.nextPickNo
        ? 'You pick at ' + ctx.pickNo + ', then ' + (ctx.nextPickNo || '—')
        : '';
    }
  }

  var turnStamp = U.store.get('ft.turnStamp', null);
  function noteTurnChange(pickNo) {
    if (!turnStamp || turnStamp.pickNo !== pickNo) {
      turnStamp = { pickNo: pickNo, at: Date.now() };
      U.store.set('ft.turnStamp', turnStamp);
    }
  }
  function secondsLeft() {
    if (!turnStamp) return null;
    var total = State.S.settings.pickTimerSec || 60;
    var used = (Date.now() - turnStamp.at) / 1000;
    return Math.max(0, Math.round(total - used));
  }

  /* --------------------------------------------------------------- BOARD */
  function renderBoard(ctx) {
    var list = byId('boardList');
    list.innerHTML = '';
    var taken = State.takenKeys();
    var hideTaken = byId('hideTaken').checked;
    var byFit = byId('sortValue').checked;
    var mineKeys = {}; State.myPlayers().forEach(function (p) { mineKeys[p.key] = 1; });

    var rows = State.S.pool.filter(function (p) {
      if (boardFilter !== 'ALL' && p.pos !== boardFilter) return false;
      if (hideTaken && taken[p.key]) return false;
      if (boardQuery && U.normName(p.name).indexOf(boardQuery) < 0) return false;
      return true;
    });

    if (byFit) {
      var scoreByKey = {};
      Engine.recommend(ctx, 0).all.forEach(function (r) { scoreByKey[r.player.key] = r.score; });
      rows.sort(function (a, b) {
        var x = scoreByKey[a.key], y = scoreByKey[b.key];
        if (x == null && y == null) return a.rank - b.rank;
        if (x == null) return 1;
        if (y == null) return -1;
        return y - x;
      });
    } else {
      rows.sort(function (a, b) { return a.rank - b.rank; });
    }

    if (!rows.length) {
      list.appendChild(el('div', 'empty', boardQuery ? 'No player matches “' + boardQuery + '”.' : 'Nothing here.'));
      byId('boardMore').hidden = true;
      return;
    }

    var shown = rows.slice(0, boardLimit);
    var lastTier = null, lastBand = null;
    var grouping = (boardFilter !== 'ALL' && !byFit && !boardQuery);

    shown.forEach(function (p) {
      if (grouping && p.tier !== lastTier) {
        lastTier = p.tier;
        var left = rows.filter(function (q) { return q.tier === p.tier; }).length;
        var h = el('div', 'tierhead');
        h.appendChild(el('span', null, p.tier == null ? 'Unranked' : 'Tier ' + p.tier));
        h.appendChild(el('span', 'cnt', left + ' left'));
        list.appendChild(h);
      } else if (!grouping && !boardQuery) {
        var band = Math.ceil(p.rank / State.S.settings.teams);
        if (band !== lastBand && band <= State.S.settings.rounds) {
          lastBand = band;
          var hb = el('div', 'tierhead');
          hb.appendChild(el('span', null, 'Round ' + band + ' range'));
          list.appendChild(hb);
        }
      }
      list.appendChild(boardRow(p, !!taken[p.key], !!mineKeys[p.key]));
    });

    var more = byId('boardMore');
    more.hidden = rows.length <= boardLimit;
    more.textContent = 'Show more (' + (rows.length - boardLimit) + ' hidden)';
  }

  function boardRow(p, isTaken, isMine) {
    var b = el('button', 'prow' + (isTaken ? ' taken' : '') + (isMine ? ' mine' : ''));
    b.type = 'button';
    b.appendChild(el('div', 'prow-rank', '#' + p.rank));
    var body = el('div', 'prow-body');
    body.appendChild(el('div', 'prow-name', p.name));
    var sub = el('div', 'prow-sub');
    sub.appendChild(posChip(p.pos));
    if (p.team) sub.appendChild(el('span', null, p.team));
    if (p.bye != null) sub.appendChild(el('span', null, 'bye ' + p.bye));
    if (p.tier != null) sub.appendChild(el('span', 'tierchip', 'T' + p.tier));
    body.appendChild(sub);
    b.appendChild(body);
    var right = el('div', 'prow-right');
    var nb = noteBadge(p.note); if (nb) right.appendChild(nb);
    if (isMine) right.appendChild(el('span', 'badge up', 'MINE'));
    b.appendChild(right);
    b.addEventListener('click', function () { openPlayerSheet(p, isTaken); });
    return b;
  }

  function openPlayerSheet(p, isTaken) {
    var sub = [p.pos, p.team, p.bye != null ? 'bye ' + p.bye : null,
               p.tier != null ? 'tier ' + p.tier : null, '#' + p.rank]
      .filter(Boolean).join(' · ');
    var opts;
    if (isTaken) {
      var pick = State.takenKeys()[p.key];
      opts = [{ label: 'Undo — put him back on the board', cls: '', onClick: function () {
        State.removePick(pick.pickNo);
      } }];
      sub += '  ·  taken at pick ' + pick.pickNo;
    } else {
      opts = [
        { label: 'I drafted him', cls: 'go', onClick: function () { State.markTaken(p, State.S.settings.mySlot); } },
        { label: 'Another team drafted him', onClick: function () { State.markTaken(p); } }
      ];
    }
    var node = null;
    if (p.note && p.note.note) { node = el('div', 'sheet-sub', '📣 ' + p.note.note); }
    Sheet.open({ title: p.name, sub: sub, node: node, options: opts });
  }

  /* -------------------------------------------------------------- ROSTER */
  function renderRoster(ctx) {
    var mine = State.myPlayers();
    var r = Engine.buildRoster(mine);

    var grid = byId('starterGrid'); grid.innerHTML = '';
    r.slots.forEach(function (s) {
      var row = el('div', 'slot' + (s.player ? '' : ' empty'));
      row.appendChild(el('div', 'slot-tag', s.slot));
      row.appendChild(el('div', 'slot-name', s.player ? s.player.name : 'empty'));
      if (s.player) {
        var right = el('div', 'prow-right');
        right.appendChild(posChip(s.player.pos));
        if (s.player.bye != null) right.appendChild(el('span', 'tierchip', 'bye ' + s.player.bye));
        row.appendChild(right);
      }
      grid.appendChild(row);
    });

    byId('benchCount').textContent = r.bench.length + ' of ' + Engine.LEAGUE.bench;
    var bl = byId('benchList'); bl.innerHTML = '';
    if (!r.bench.length) bl.appendChild(el('div', 'empty', 'No bench players yet.'));
    r.bench.forEach(function (p) {
      var row = el('div', 'benchrow');
      row.appendChild(posChip(p.pos));
      row.appendChild(el('div', 'slot-name', p.name));
      if (p.bye != null) row.appendChild(el('span', 'tierchip', 'bye ' + p.bye));
      bl.appendChild(row);
    });

    // Bye chart over the weeks that actually have byes on this roster.
    var starters = r.slots.map(function (s) { return s.player; }).filter(Boolean);
    var load = Engine.byeLoad(starters);
    var weeks = [];
    for (var w = 5; w <= 14; w++) weeks.push(w);
    var chart = byId('byeChart'); chart.innerHTML = '';
    var max = Math.max(1, Math.max.apply(null, weeks.map(function (w) { return (load[w] || []).length; })));
    var worst = 0;
    weeks.forEach(function (w) {
      var n = (load[w] || []).length;
      if (n > worst) worst = n;
      var col = el('div', 'byecol');
      col.appendChild(el('div', 'byeval', n ? String(n) : ''));
      var bar = el('div', 'byebar' + (n >= 3 ? ' hot' : n === 2 ? ' warm' : n ? ' ok' : ''));
      bar.style.height = (n / max * 70) + 'px';
      col.appendChild(bar);
      col.appendChild(el('div', 'byelab', String(w)));
      chart.appendChild(col);
    });
    var unknown = starters.filter(function (p) { return p.bye == null; }).length;
    byId('byeHint').textContent = 'Starters on bye each week. 3+ in one week means a rough lineup that week.' +
      (unknown ? ' (' + unknown + ' starter' + (unknown > 1 ? 's have' : ' has') + ' no bye week on file — load the Sleeper player DB, or set byes on the Draft tab.)' : '');

    var counts = State.counts(mine);
    var pc = byId('posCounts'); pc.innerHTML = '';
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(function (pos) {
      var n = counts[pos] || 0, target = Engine.TARGET[pos];
      var card = el('div', 'pcard' + (n < (Engine.LEAGUE.starters[pos] || 0) ? ' short' : '') +
                                (n > (Engine.HARD_CAP[pos] || 9) ? ' over' : ''));
      card.appendChild(el('div', 'n', String(n)));
      card.appendChild(el('div', 'l', pos));
      card.appendChild(el('div', 't', 'target ' + target));
      pc.appendChild(card);
    });

    renderSummary(ctx, mine, r);
  }

  function renderSummary(ctx, mine, roster) {
    var box = byId('summary');
    box.innerHTML = '';
    var st = State.S.settings;
    if (State.currentPickNo() <= st.teams * st.rounds) return;   // draft still running

    box.appendChild(el('h2', 'sect', 'Post-draft summary'));
    var card = el('div', 'card');
    var mineByPick = State.S.picks.filter(function (p) { return p.slot === st.mySlot; });
    var deltas = [];
    mineByPick.forEach(function (pick) {
      var p = State.S.poolByKey[pick.key];
      if (p && p.rank != null) deltas.push(pick.pickNo - p.rank);
    });
    var avg = deltas.length ? deltas.reduce(function (a, b) { return a + b; }, 0) / deltas.length : 0;
    card.appendChild(el('div', 'statusline',
      'You drafted ' + mineByPick.length + ' players. Average value vs board rank: ' +
      (avg >= 0 ? '+' : '') + avg.toFixed(1) + ' picks ' + (avg >= 0 ? '(you got players later than their rank — good)' : '(you reached slightly)')));
    var starters = roster.slots.map(function (s) { return s.player; }).filter(Boolean);
    var load = Engine.byeLoad(starters);
    var bad = Object.keys(load).filter(function (w) { return load[w].length >= 3; });
    card.appendChild(el('div', 'statusline', bad.length
      ? 'Bye-week trouble: week ' + bad.join(', ') + ' (3+ starters out). Plan waiver pickups.'
      : 'No week has 3+ starters on bye. Good spread.'));
    box.appendChild(card);
  }

  /* --------------------------------------------------------------- DRAFT */
  function renderDraft() {
    var st = State.S.settings, sync = Sleeper.Sync;
    setVal('fLeague', st.leagueId); setVal('fUser', st.username);
    setVal('fSlot', st.mySlot); setVal('fTeams', st.teams); setVal('fDraft', st.draftId || '');
    setVal('fProxy', st.proxyBase || '');
    byId('fAuto').checked = !!st.autoSync;

    var line = sync.status === 'live'
      ? '🟢 Live. Last update ' + (sync.lastPollAt ? timeAgo(sync.lastPollAt) : 'just now') + '.'
      : sync.status === 'error' ? '🔴 ' + sync.message
      : sync.status === 'connecting' ? '🟡 ' + sync.message
      : '⚪ Not connected — picks are being tracked by hand.';
    byId('syncStatusLine').textContent = line +
      (st.slotAutoDetected ? '  Slot ' + st.mySlot + ' detected from your username.' : '');

    var loadedAt = Sleeper.playersLoadedAt();
    var n = State.S.sleeperPlayers ? Object.keys(State.S.sleeperPlayers).length : 0;
    byId('dataStatusLine').textContent = loadedAt
      ? n + ' players cached (' + timeAgo(loadedAt) + '). Board: ' + State.S.pool.length + ' players.'
      : 'Player DB not loaded. Board: ' + State.S.pool.length + ' players from the strategy doc.';

    byId('boardSrc').textContent = window.BOARD_DATA.source +
      (window.NOTES_DATA.generated ? ' · notes ' + window.NOTES_DATA.generated : ' · no news layer loaded');

    var demoBtn = byId('btnDemo');
    demoBtn.textContent = Demo.isOn() ? 'Stop practice draft' : 'Start practice draft';
    demoBtn.className = Demo.isOn() ? 'ghost danger' : 'primary';
    byId('demoStatusLine').textContent = Demo.isOn()
      ? 'Practice running — round ' + U.roundOf(State.currentPickNo(), st.teams) +
        '. Nothing here touches your real draft.'
      : 'Not running. Rehearse the whole thing before draft day.';

    var log = byId('pickLog'); log.innerHTML = '';
    byId('logCount').textContent = State.S.picks.length + ' picks';
    var recent = State.S.picks.slice().reverse().slice(0, 60);
    if (!recent.length) log.appendChild(el('div', 'empty', 'No picks yet.'));
    recent.forEach(function (p) {
      var row = el('div', 'logrow' + (p.slot === st.mySlot ? ' mine' : ''));
      row.appendChild(el('div', 'pn', '#' + p.pickNo));
      if (p.pos) row.appendChild(posChip(p.pos));
      row.appendChild(el('div', 'nm', p.name));
      row.appendChild(el('div', 'who', p.slot === st.mySlot ? 'YOU' : 'slot ' + p.slot));
      log.appendChild(row);
    });
  }

  function setVal(id, v) {
    var n = byId(id);
    if (n && document.activeElement !== n) n.value = v == null ? '' : v;
  }

  function timeAgo(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  /* --------------------------------------------------------------- render */
  function render() {
    var ctx = State.context();
    noteTurnChange(State.currentPickNo());
    renderTopbar(ctx);
    renderBanner();
    if (view === 'now') renderNow(ctx);
    if (view === 'board') renderBoard(ctx);
    if (view === 'roster') renderRoster(ctx);
    if (view === 'draft') renderDraft();
  }

  function setView(v) {
    view = v;
    ['now', 'board', 'roster', 'draft'].forEach(function (name) {
      byId('view-' + name).hidden = (name !== v);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.dataset.view === v);
    });
    window.scrollTo(0, 0);
    render();
  }

  global.UI = {
    render: render, setView: setView, Sheet: Sheet, secondsLeft: secondsLeft,
    setBoardFilter: function (p) { boardFilter = p; boardLimit = 120; render(); },
    setBoardQuery: function (q) { boardQuery = U.normName(q); boardLimit = 120; render(); },
    moreBoard: function () { boardLimit += 120; render(); },
    getView: function () { return view; },
    posChip: posChip, timeAgo: timeAgo, el: el, lastName: lastName
  };
})(window);
