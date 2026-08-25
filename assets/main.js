/* =============================================================================
   main.js — wiring: events, polling lifecycle, paste importers.
   ========================================================================== */
(function () {
  'use strict';

  var byId = U.byId, el = U.el;

  var NFL_TEAMS = ('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAC JAX KC LV LAC LAR MIA ' +
                   'MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS WSH').split(' ');
  var POS_RE = /^(QB|RB|WR|TE|K|PK|DST|D\/ST|DEF)\d*$/i;

  /* ------------------------------------------------------------- importers */

  /* Tolerant rankings parser. Handles, in one pass:
       "1. Jahmyr Gibbs RB DET (6)"        numbered cheat-sheet lines
       "1,Jahmyr Gibbs,DET,RB,..."         FantasyPros-style CSV
       "Tier 3: Name, Name, Name"          Boris Chen-style tier blocks
     Anything it can't parse is reported back rather than silently dropped.  */
  function parseRankings(text) {
    var out = {}, errors = [], rank = 0, currentTier = null;
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (/^(rank|rk|overall|player|tier)\b.*\b(player|name)\b/i.test(line)) return;  // header row

      var tierBlock = line.match(/^tier\s*(\d+)\s*[:\-]\s*(.+)$/i);
      if (tierBlock) {
        currentTier = parseInt(tierBlock[1], 10);
        tierBlock[2].split(/\s*,\s*/).forEach(function (nm) {
          nm = nm.trim();
          if (!nm) return;
          var got = extract(nm);
          if (!got.name) return;
          rank++;
          add(out, got, rank, currentTier);
        });
        return;
      }
      var tierOnly = line.match(/^tier\s*(\d+)\s*:?\s*$/i);
      if (tierOnly) { currentTier = parseInt(tierOnly[1], 10); return; }

      var m = line.match(/^(\d+)[.)]?\s+(.*)$/);
      var rest = line;
      if (m) { rank = parseInt(m[1], 10); rest = m[2]; } else { rank++; }
      var got = extract(rest);
      if (!got.name) { errors.push(raw); return; }
      add(out, got, rank, got.tier != null ? got.tier : currentTier);
    });
    return { map: out, errors: errors, count: Object.keys(out).length };
  }

  function add(map, got, rank, tier) {
    if (!got.pos) return;                       // position is required to key a player
    map[State.keyOf(got.name, got.pos)] = {
      name: got.name, pos: got.pos, team: got.team, bye: got.bye,
      rank: rank, tier: tier, adp: got.adp
    };
  }

  /* Pull name / position / team / bye out of one messy line. */
  function extract(s) {
    s = s.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
    var parts = s.split(/\s*[,|\t]\s*|\s+/).filter(Boolean);
    var pos = null, team = null, bye = null, adp = null, nameParts = [];
    parts.forEach(function (tok) {
      var t = tok.replace(/[()]/g, '');
      if (!pos && POS_RE.test(t)) {
        pos = t.toUpperCase().replace(/\d+$/, '').replace('PK', 'K').replace('D/ST', 'DEF').replace('DST', 'DEF');
        return;
      }
      if (!team && NFL_TEAMS.indexOf(t.toUpperCase()) >= 0 && nameParts.length) {
        team = U.normTeam(t); return;
      }
      if (/^\d{1,2}$/.test(t) && (pos || team)) {           // bye week
        var n = parseInt(t, 10);
        if (n >= 1 && n <= 18 && bye == null) { bye = n; return; }
      }
      if (/^\d{1,3}(\.\d)?$/.test(t) && (pos || team) && adp == null && bye != null) {
        adp = parseFloat(t); return;
      }
      if (/^(bye|adp|proj|pts|fpts|tier)$/i.test(t)) return;
      if (/^[\d.]+$/.test(t)) return;
      nameParts.push(tok.replace(/[,|]/g, ''));
    });
    return { name: nameParts.join(' ').trim(), pos: pos, team: team, bye: bye, adp: adp };
  }

  /* "Name | tag | note"  (tag optional) */
  function parseNotes(text) {
    var out = {}, errors = [];
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || /^#/.test(line)) return;
      var parts = line.split('|').map(function (s) { return s.trim(); });
      if (parts.length < 2) { errors.push(raw); return; }
      var name = parts[0], tag = null, note;
      if (parts.length >= 3 && /^(up|down|injury|watch|safe)$/i.test(parts[1])) {
        tag = parts[1].toLowerCase(); note = parts.slice(2).join(' | ');
      } else {
        note = parts.slice(1).join(' | ');
        if (/\b(out|questionable|doubtful|injur|strain|sprain|surgery|pup|ir)\b/i.test(note)) tag = 'injury';
        else if (/\b(limited|battle|competition|unclear|committee)\b/i.test(note)) tag = 'watch';
        else if (/\b(trending up|breakout|locked|starting role|first team)\b/i.test(note)) tag = 'up';
      }
      out[U.normName(name)] = { tag: tag, note: note };
    });
    return { map: out, errors: errors, count: Object.keys(out).length };
  }

  /* "DET 6", "DET:6", "DET,6" — one per line or all on one line. */
  function parseByes(text) {
    var out = {}, errors = [];
    (text.match(/[A-Za-z]{2,3}\s*[:,\s]\s*\d{1,2}/g) || []).forEach(function (pair) {
      var m = pair.match(/([A-Za-z]{2,3})\s*[:,\s]\s*(\d{1,2})/);
      var team = U.normTeam(m[1]);
      if (NFL_TEAMS.indexOf(team) < 0) { errors.push(pair); return; }
      out[team] = parseInt(m[2], 10);
    });
    return { map: out, errors: errors, count: Object.keys(out).length };
  }

  /* --------------------------------------------------------------- dialogs */
  function pasteDialog(opts) {
    var wrap = el('div');
    var ta = document.createElement('textarea');
    ta.placeholder = opts.placeholder || '';
    wrap.appendChild(ta);
    var msg = el('div', 'hint', opts.help || '');
    msg.style.margin = '8px 0 0';
    wrap.appendChild(msg);
    var go = el('button', 'opt go', opts.action || 'Import');
    go.type = 'button';
    go.addEventListener('click', function () {
      var res = opts.onImport(ta.value);
      msg.textContent = res;
    });
    wrap.appendChild(go);
    UI.Sheet.open({ title: opts.title, sub: opts.sub, node: wrap });
  }

  function importRankings() {
    pasteDialog({
      title: 'Paste fresh rankings',
      sub: 'Overrides ranks and tiers on the board. Copy from FantasyPros, 4for4, Boris Chen — the parser is forgiving.',
      placeholder: '1. Jahmyr Gibbs RB DET 6\n2. Bijan Robinson RB ATL 11\n…\n\nor\n\nTier 1: Gibbs, Robinson, Chase\nTier 2: Nacua, Taylor',
      help: 'Half-PPR rankings work best for this league.',
      action: 'Import rankings',
      onImport: function (txt) {
        if (!txt.trim()) return 'Nothing pasted.';
        var r = parseRankings(txt);
        if (!r.count) return 'Could not read any players. Each line needs a name and a position.';
        State.setRankOverrides(r.map);
        return 'Imported ' + r.count + ' players.' +
          (r.errors.length ? ' Skipped ' + r.errors.length + ' line(s) I could not read.' : '');
      }
    });
  }

  function importNotes() {
    pasteDialog({
      title: 'Paste player notes',
      sub: 'The injury / depth-chart layer. One player per line.',
      placeholder: 'Puka Nacua | injury | limited in practice all week\nBucky Irving | up | locked down the starting job\nJavonte Williams | watch | committee backfield',
      help: 'Format: Name | tag | note. Tags: up, down, injury, watch, safe.',
      action: 'Import notes',
      onImport: function (txt) {
        if (!txt.trim()) return 'Nothing pasted.';
        var r = parseNotes(txt);
        if (!r.count) return 'Could not read any notes. Use: Name | tag | note';
        State.setNoteOverrides(r.map);
        window.NOTES_DATA.generated = new Date().toISOString().slice(0, 10);
        return 'Imported ' + r.count + ' notes.' + (r.errors.length ? ' Skipped ' + r.errors.length + ' line(s).' : '');
      }
    });
  }

  function importByes() {
    var known = Object.assign({}, window.BOARD_DATA.byes, State.S.byeOverrides);
    var missing = NFL_TEAMS.filter(function (t) {
      return ['JAX', 'WSH'].indexOf(t) < 0 && known[t] == null;
    });
    pasteDialog({
      title: 'Bye weeks',
      sub: missing.length ? 'Missing: ' + missing.join(' ') : 'All 32 teams have a bye on file.',
      placeholder: 'DET 6\nATL 11\nCIN 6\n\n(or: DET:6, ATL:11, CIN:6)',
      help: 'The strategy doc only named 18 teams. Fill the rest in and bye-clash warnings cover your whole roster.',
      action: 'Save bye weeks',
      onImport: function (txt) {
        if (!txt.trim()) return 'Nothing pasted.';
        var r = parseByes(txt);
        if (!r.count) return 'Could not read any team/week pairs.';
        State.setByes(r.map);
        return 'Saved ' + r.count + ' bye weeks.' + (r.errors.length ? ' Ignored: ' + r.errors.join(', ') : '');
      }
    });
  }

  /* ----------------------------------------------------------------- wiring */
  function bind() {
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (t) UI.setView(t.dataset.view);
    });

    byId('sheet').addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.close) UI.Sheet.close();
    });

    byId('posChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      Array.prototype.forEach.call(this.querySelectorAll('.chip'), function (x) { x.classList.remove('on'); });
      c.classList.add('on');
      UI.setBoardFilter(c.dataset.pos);
    });
    byId('boardSearch').addEventListener('input', function () { UI.setBoardQuery(this.value); });
    byId('hideTaken').addEventListener('change', UI.render);
    byId('sortValue').addEventListener('change', UI.render);
    byId('boardMore').addEventListener('click', UI.moreBoard);

    // Manual pick search on the Draft tab
    byId('manualSearch').addEventListener('input', function () {
      var box = byId('manualResults');
      box.innerHTML = '';
      var rows = State.search(this.value, 8);
      rows.forEach(function (r) {
        var b = el('button', 'prow' + (r.taken ? ' taken' : ''));
        b.type = 'button';
        b.appendChild(el('div', 'prow-rank', '#' + r.player.rank));
        var body = el('div', 'prow-body');
        body.appendChild(el('div', 'prow-name', r.player.name));
        var sub = el('div', 'prow-sub');
        sub.appendChild(UI.posChip(r.player.pos));
        if (r.player.team) sub.appendChild(el('span', null, r.player.team));
        if (r.taken) sub.appendChild(el('span', null, 'already drafted'));
        body.appendChild(sub);
        b.appendChild(body);
        b.addEventListener('click', function () {
          if (r.taken) return;
          State.markTaken(r.player);
          byId('manualSearch').value = '';
          box.innerHTML = '';
        });
        box.appendChild(b);
      });
    });

    byId('btnUnknown').addEventListener('click', function () {
      State.addUnknownPick();
    });
    byId('btnUndo').addEventListener('click', function () {
      State.undoLastPick();
    });
    byId('btnReset').addEventListener('click', function () {
      UI.Sheet.open({
        title: 'Reset the draft?',
        sub: 'Clears every pick. Settings and cached players stay.',
        options: [{ label: 'Yes, clear all picks', cls: '', onClick: function () { State.resetDraft(); } }]
      });
    });

    // Settings fields
    [['fLeague', 'leagueId'], ['fUser', 'username'], ['fDraft', 'draftId'],
     ['fProxy', 'proxyBase']].forEach(function (p) {
      byId(p[0]).addEventListener('change', function () {
        var patch = {}; patch[p[1]] = this.value.trim() || null;
        State.setSettings(patch);
      });
    });
    [['fSlot', 'mySlot'], ['fTeams', 'teams']].forEach(function (p) {
      byId(p[0]).addEventListener('change', function () {
        var v = parseInt(this.value, 10);
        if (!isFinite(v) || v < 1) return;
        var patch = {}; patch[p[1]] = v;
        if (p[1] === 'mySlot') patch.slotAutoDetected = false;
        State.setSettings(patch);
      });
    });
    byId('fAuto').addEventListener('change', function () {
      State.setSettings({ autoSync: this.checked });
      if (this.checked) { if (State.S.settings.draftId) Sleeper.start(); }
      else Sleeper.stop();
    });

    byId('btnConnect').addEventListener('click', function () {
      var b = this; b.disabled = true; b.textContent = 'Connecting…';
      Sleeper.connect()
        .then(function () { if (State.S.settings.autoSync) Sleeper.start(); })
        .catch(function () {})
        .then(function () { b.disabled = false; b.textContent = 'Connect'; UI.render(); });
    });

    byId('btnDiag').addEventListener('click', function () {
      var out = byId('diagOut');
      out.innerHTML = '<div>Testing…</div>';
      Sleeper.diagnose().then(function (rows) {
        out.innerHTML = '';
        rows.forEach(function (r) { out.appendChild(el('div', r.ok ? 'ok' : 'no', r.text)); });
      });
    });

    byId('btnPlayers').addEventListener('click', function () {
      var b = this, status = byId('dataStatusLine');
      b.disabled = true;
      Sleeper.loadPlayers(function (m) { status.textContent = m; })
        .then(function (n) { status.textContent = 'Loaded ' + n + ' players.'; })
        .catch(function (e) { status.textContent = '✕ ' + e.message; })
        .then(function () { b.disabled = false; UI.render(); });
    });

    byId('btnPasteRanks').addEventListener('click', importRankings);
    byId('btnPasteNotes').addEventListener('click', importNotes);
    byId('btnByes').addEventListener('click', importByes);

    // Re-poll the moment the phone comes back from sleep / tab switch.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && State.S.settings.autoSync && State.S.settings.draftId) {
        Sleeper.poll().catch(function () {}).then(UI.render);
      }
    });
  }

  /* -------------------------------------------------------------------- go */
  function init() {
    State.rebuildPool();
    State.on(UI.render);
    Sleeper.on(UI.render);
    bind();
    UI.setView('now');

    if (State.S.settings.autoSync && State.S.settings.draftId) {
      Sleeper.start();
    } else if (State.S.settings.autoSync && State.S.settings.leagueId) {
      Sleeper.connect().then(function () { Sleeper.start(); }).catch(function () {});
    }

    // 1s heartbeat: keeps the pick clock and "x ago" labels honest.
    setInterval(function () {
      if (UI.getView() === 'now' || UI.getView() === 'draft') UI.render();
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Importers = { parseRankings: parseRankings, parseNotes: parseNotes, parseByes: parseByes };
})();
