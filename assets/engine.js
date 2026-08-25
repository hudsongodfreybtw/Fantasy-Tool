/* =============================================================================
   engine.js — value model + recommendation engine
   -----------------------------------------------------------------------------
   Encodes the strategy from fantasydraftstrategy.pdf Section 4:
     R1-2  best RB/WR by tier, no QB/TE reaches
     R3-6  keep building RB/WR core, top-tier TE if value is right
     R7-9  QB1 window
     R10-13 depth / handcuffs / upside
     R14-16 K then DEF, never two of either

   Design: score = rawValue(rank) * PRODUCT(multipliers).  Multiplicative on
   purpose — early on, value gaps are huge and swamp roster need (you should
   never reach in round 2); late, values are flat and need/scarcity decide.
   Every multiplier is recorded so the UI can explain *why* in one line.
   ========================================================================== */
(function (global) {
  'use strict';

  var LEAGUE = {
    teams: 12,
    rounds: 16,
    mySlot: 7,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    flexEligible: ['RB', 'WR', 'TE'],
    bench: 5
  };

  // Roster shape we are aiming at by the end of 16 rounds (doc Section 4).
  var TARGET = { QB: 1, RB: 5, WR: 5, TE: 1, K: 1, DEF: 1 };
  var HARD_CAP = { QB: 2, RB: 7, WR: 7, TE: 2, K: 1, DEF: 1 };

  // Depth multiplier by how many of that position you already own.
  // Index = current count. Encodes "you have 4 RBs already, pivot".
  var DEPTH = {
    RB:  [1.22, 1.20, 1.12, 1.00, 0.86, 0.66, 0.34, 0.10],
    WR:  [1.20, 1.18, 1.10, 1.00, 0.86, 0.66, 0.34, 0.10],
    TE:  [1.00, 0.42, 0.05, 0.02],
    QB:  [1.00, 0.30, 0.04, 0.02],
    K:   [1.00, 0.00, 0.00],
    DEF: [1.00, 0.00, 0.00]
  };

  /* Round gating. Returns a multiplier for taking `pos` in `round` given how
     many you already have. This is where "don't draft a QB early" lives.     */
  function roundGate(pos, round, have) {
    if (pos === 'QB') {
      if (have >= 1) return round >= 12 ? 0.55 : 0.22;   // QB2 is a late luxury
      if (round <= 4) return 0.20;                        // doc: never
      if (round === 5) return 0.45;
      if (round === 6) return 0.85;
      if (round <= 9) return 1.18;                        // the QB window
      if (round <= 11) return 1.45;                       // getting late
      return 1.9;                                         // you NEED a QB
    }
    if (pos === 'K') {
      if (have >= 1) return 0;                            // never draft two
      if (round <= 12) return 0.02;
      if (round === 13) return 0.25;
      if (round === 14) return 0.95;
      return 1.8;
    }
    if (pos === 'DEF') {
      if (have >= 1) return 0;
      if (round <= 11) return 0.02;
      if (round <= 13) return 0.55;
      return 1.7;
    }
    if (pos === 'TE') {
      if (have >= 2) return 0.03;
      if (have === 1) return round >= 11 ? 0.55 : 0.40;   // TE2 only late
      if (round <= 2) return 0.80;   // only a true elite TE should surface here
      if (round <= 6) return 1.05;
      if (round <= 10) return 1.15;
      if (round <= 13) return 1.45;
      return 1.9;
    }
    if (pos === '__unused__') return 1;
    // RB / WR: the doc wants these early and often.
    if (round <= 2) return 1.10;
    if (round <= 6) return 1.05;
    return 1.0;
  }

  /* Starter-slot pressure: unfilled required starters at this position.      */
  function starterGap(pos, counts) {
    var need = LEAGUE.starters[pos] || 0;
    return Math.max(0, need - (counts[pos] || 0));
  }

  function flexFilled(counts) {
    var surplus = Math.max(0, (counts.RB || 0) - LEAGUE.starters.RB) +
                  Math.max(0, (counts.WR || 0) - LEAGUE.starters.WR) +
                  Math.max(0, (counts.TE || 0) - LEAGUE.starters.TE);
    return surplus >= LEAGUE.starters.FLEX;
  }

  /* Raw board value from overall rank. Steep at the top, deliberately FLAT at
     the bottom: past ~rank 100 the real gaps are noise, and a flat tail is what
     lets roster need (not a meaningless 3-rank edge) decide the late rounds.  */
  function rawValue(rank) {
    return 3 + 100 * Math.exp(-(rank - 1) / 38);
  }

  /* Must-fill pressure. With 16 rounds and mandatory QB/TE/K/DEF slots, there
     is a point where "best player available" is wrong and "you literally have
     no rounds left to fill DEF" is right. slack = spare picks after covering
     every unfilled mandatory slot.                                           */
  function mandatory(ctx) {
    var c = ctx.counts, miss = [];
    for (var i = (c.RB || 0); i < LEAGUE.starters.RB; i++) miss.push('RB');
    for (var j = (c.WR || 0); j < LEAGUE.starters.WR; j++) miss.push('WR');
    if ((c.QB || 0)  < 1) miss.push('QB');
    if ((c.TE || 0)  < 1) miss.push('TE');
    if ((c.K || 0)   < 1) miss.push('K');
    if ((c.DEF || 0) < 1) miss.push('DEF');
    return { missing: miss, slack: (LEAGUE.rounds - ctx.round + 1) - miss.length };
  }

  function mandatoryMult(pos, m) {
    var needed = m.missing.indexOf(pos) >= 0;
    if (needed) {
      if (m.slack <= 0) return 6.0;    // no spare picks left: fill it NOW
      if (m.slack === 1) return 2.2;
      if (m.slack === 2) return 1.30;
      return 1.0;
    }
    if (m.slack <= 0) return 0.05;     // everything else is unaffordable
    if (m.slack === 1) return 0.50;
    return 1.0;
  }

  /* Probability a player is still on the board at pick `target`.
     adpEff falls back to board rank when we have no real ADP.               */
  function survival(player, targetPick, sigma) {
    var adp = player.adp != null ? player.adp : player.rank;
    if (adp == null) return 0.5;
    var s = sigma || 9;
    return 1 / (1 + Math.exp((targetPick - adp) / s));
  }

  function noteAdjust(note, round) {
    if (!note || !note.tag) return { mult: 1, why: null };
    var early = round <= 4 ? 1.5 : 1;   // doc: avoid risk in rounds 1-4
    switch (note.tag) {
      case 'injury': return { mult: 1 - 0.13 * early, why: note.note || 'injury flag' };
      case 'down':   return { mult: 1 - 0.08 * early, why: note.note || 'trending down' };
      case 'watch':  return { mult: 1 - 0.04 * early, why: note.note || 'situation unclear' };
      case 'up':     return { mult: 1 + 0.07,          why: note.note || 'trending up' };
      case 'safe':   return { mult: 1 + 0.03 * early,  why: note.note || 'locked-in starter' };
      default:       return { mult: 1, why: note.note || null };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Roster: assign owned players to starter slots, best-first.              */
  function buildRoster(myPlayers) {
    var pool = myPlayers.slice().sort(function (a, b) { return a.rank - b.rank; });
    var slots = [], used = {};
    function take(pos) {
      for (var i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        if (pool[i].pos === pos) { used[i] = true; return pool[i]; }
      }
      return null;
    }
    function takeFlex() {
      for (var i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        if (LEAGUE.flexEligible.indexOf(pool[i].pos) >= 0) { used[i] = true; return pool[i]; }
      }
      return null;
    }
    var plan = [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1]];
    plan.forEach(function (p) {
      for (var n = 0; n < p[1]; n++) {
        slots.push({ slot: p[0] + (p[1] > 1 ? (n + 1) : ''), pos: p[0], player: take(p[0]) });
      }
    });
    slots.push({ slot: 'FLEX', pos: 'FLEX', player: takeFlex() });
    slots.push({ slot: 'K', pos: 'K', player: take('K') });
    slots.push({ slot: 'DEF', pos: 'DEF', player: take('DEF') });
    var bench = pool.filter(function (p, i) { return !used[i]; });
    return { slots: slots, bench: bench };
  }

  /* Bye-week load per week among a set of players (starters only matter).    */
  function byeLoad(players) {
    var m = {};
    players.forEach(function (p) {
      if (p.bye == null) return;
      (m[p.bye] = m[p.bye] || []).push(p);
    });
    return m;
  }

  /* Penalty for stacking byes at the same position (doc: nice-to-have).      */
  function byeClash(player, myPlayers) {
    if (player.bye == null) return { mult: 1, why: null };
    var samePosSameBye = myPlayers.filter(function (p) {
      return p.pos === player.pos && p.bye === player.bye;
    }).length;
    var limit = (player.pos === 'RB' || player.pos === 'WR') ? 2 : 1;
    if (samePosSameBye >= limit) {
      return {
        mult: 1 - Math.min(0.09, 0.045 * (samePosSameBye - limit + 1)),
        why: 'would be ' + (samePosSameBye + 1) + ' ' + player.pos + 's on bye wk ' + player.bye
      };
    }
    return { mult: 1, why: null };
  }

  /* ---------------------------------------------------------------------- */
  /* Main scorer.
     ctx = { round, pickNo, nextPickNo, counts, myPlayers, available, notes } */
  function scorePlayer(player, ctx) {
    var f = [];   // factor log: {k, mult, why}
    var have = ctx.counts[player.pos] || 0;

    var base = rawValue(player.rank);

    var gate = roundGate(player.pos, ctx.round, have);
    // TE shape from the doc: "either pay up top-2 or wait". Tier 1-2 TEs are
    // worth a real mid-round pick; tier 3+ are streaming fodder, so don't
    // spend a pick climbing that part of the list.
    if (player.pos === 'TE' && have === 0 && player.tier != null) {
      if (player.tier <= 2 && ctx.round >= 3 && ctx.round <= 8) gate *= 1.18;
      else if (player.tier >= 4 && ctx.round <= 11) gate *= 0.75;
    }
    f.push({ k: 'round', mult: gate });

    var mand = mandatory(ctx);
    var mMult = mandatoryMult(player.pos, mand);
    f.push({ k: 'must', mult: mMult, slack: mand.slack, missing: mand.missing });

    var depthArr = DEPTH[player.pos] || [1, 1, 1, 1];
    var depth = depthArr[Math.min(have, depthArr.length - 1)];
    f.push({ k: 'depth', mult: depth });

    // Starter-slot need
    var gap = starterGap(player.pos, ctx.counts);
    var needMult = 1 + 0.14 * gap;
    if (gap === 0 && !flexFilled(ctx.counts) && LEAGUE.flexEligible.indexOf(player.pos) >= 0) {
      needMult += 0.07;   // fills the FLEX
    }
    // Urgency: unfilled starter with few rounds left
    var roundsLeft = LEAGUE.rounds - ctx.round + 1;
    if (gap > 0 && roundsLeft <= 6) needMult += 0.10 * gap;
    f.push({ k: 'need', mult: needMult, gap: gap });

    // Tier cliff: does THIS tier empty out before my next turn? Counting the
    // whole position empties too easily and cries wolf every pick, so count
    // only players in this player's own tier that are likely to be gone.
    var tierLeft = 0, tierGone = 0, lowestTier = true;
    ctx.available.forEach(function (p) {
      if (p.pos !== player.pos || p.tier == null || player.tier == null) return;
      if (p.tier === player.tier) {
        tierLeft++;
        if (ctx.nextPickNo && survival(p, ctx.nextPickNo) < 0.5) tierGone++;
      } else if (p.tier > player.tier) {
        lowestTier = false;    // there is still a worse tier to fall back on
      }
    });
    var cliff = 1, cliffKind = null;
    if (player.tier != null && tierLeft > 0) {
      if (tierLeft === 1) { cliff = 1.15; cliffKind = 'last'; }
      else if (tierGone >= tierLeft && tierLeft <= 5) { cliff = 1.10; cliffKind = 'empties'; }
      else if (tierLeft === 2 && tierGone >= 1) { cliff = 1.06; cliffKind = 'thin'; }
    }
    f.push({ k: 'cliff', mult: cliff, tierLeft: tierLeft, kind: cliffKind, lowestTier: lowestTier });

    // Won't-last urgency
    var pSurv = ctx.nextPickNo ? survival(player, ctx.nextPickNo) : 0.5;
    var urgency = 1 + 0.13 * (1 - pSurv);
    f.push({ k: 'urgency', mult: urgency, pSurv: pSurv });

    // Value vs ADP (doc 8e)
    // Value vs ADP: he is a value if the draft has already passed his usual
    // slot (adp earlier than the current pick) and he is still sitting there.
    var adp = player.adp != null ? player.adp : player.rank;
    var delta = ctx.pickNo - adp;              // +ve = fell to you = value
    var adpMult = 1 + U.clamp(delta / 90, -0.10, 0.12);
    f.push({ k: 'adp', mult: adpMult, delta: delta });

    // Enrichment notes
    var note = ctx.notes ? ctx.notes[U.normName(player.name)] : null;
    var na = noteAdjust(note, ctx.round);
    f.push({ k: 'note', mult: na.mult, why: na.why, tag: note && note.tag });

    // Bye clash
    var bc = byeClash(player, ctx.myPlayers);
    f.push({ k: 'bye', mult: bc.mult, why: bc.why });

    var score = base;
    f.forEach(function (x) { score *= x.mult; });

    return {
      player: player, score: score, base: base, factors: f,
      pSurvive: pSurv, adpDelta: delta, tierLeft: tierLeft, note: note
    };
  }

  /* One-line "why", built from the biggest movers. Never more than 3 clauses,
     written for someone who has never played fantasy football.               */
  function explain(r, ctx) {
    var p = r.player, bits = [], f = {};
    r.factors.forEach(function (x) { f[x.k] = x; });

    if (p.pos === 'K' || p.pos === 'DEF') {
      if (f.must && f.must.slack <= 1) {
        bits.push('You must fill ' + p.pos + ' and you are almost out of picks');
      } else {
        bits.push('Roster filler — take any starter, do not overthink it');
      }
      return bits.join(' \u00b7 ');
    }

    // 1. Why him for YOUR roster.
    if (f.must && f.must.slack <= 1 && f.must.missing.indexOf(p.pos) >= 0) {
      bits.push('you still need a ' + p.pos + ' and have ' + (Engine.LEAGUE.rounds - ctx.round + 1) + ' picks left');
    } else if (f.need.gap > 0) {
      bits.push('fills your ' + (f.need.gap > 1 ? f.need.gap + ' open ' : 'open ') + p.pos +
                ' starter slot' + (f.need.gap > 1 ? 's' : ''));
    } else if (p.pos === 'QB' && ctx.round >= 7 && ctx.round <= 9 && (ctx.counts.QB || 0) === 0) {
      bits.push('QB window is open (rounds 7-9)');
    }

    // 2. Tier / scarcity.
    if (f.cliff.kind === 'last') {
      bits.push(f.cliff.lowestTier
        ? 'last ranked ' + p.pos + ' in tier ' + p.tier
        : 'LAST ' + p.pos + ' in tier ' + p.tier + ' — real drop after him');
    } else if (f.cliff.kind === 'empties') {
      bits.push('all ' + r.tierLeft + ' remaining tier-' + p.tier + ' ' + p.pos +
                's likely gone by pick ' + ctx.nextPickNo);
    } else if (f.cliff.kind === 'thin') {
      bits.push('only 2 ' + p.pos + 's left in tier ' + p.tier);
    } else if (p.tier != null && bits.length === 0) {
      bits.push('tier ' + p.tier + ' ' + p.pos + ', best on the board');
    } else if (p.tier == null && bits.length === 0) {
      bits.push('best available ' + p.pos);
    }

    // 3. Will he last?
    if (bits.length < 2 && ctx.nextPickNo) {
      if (r.pSurvive < 0.35) bits.push('almost certainly gone by your pick at ' + ctx.nextPickNo);
      else if (r.pSurvive > 0.78) bits.push('probably still there at ' + ctx.nextPickNo);
    }

    // 4. Value against ADP.
    if (bits.length < 3 && r.adpDelta >= 10) {
      bits.push('value — normally goes ~' + Math.round(r.adpDelta) + ' picks earlier');
    } else if (bits.length < 3 && r.adpDelta <= -14) {
      bits.push('a reach — normally goes ~' + Math.abs(Math.round(r.adpDelta)) + ' picks later');
    }

    // 5. Enrichment note always earns its place if it exists.
    if (r.note && r.note.note) bits.push(r.note.note);

    return bits.slice(0, 3).join(' \u00b7 ');
  }

  /* Public: rank the board for the current pick.
     A zero score means the pick is structurally illegal for this roster (a
     second kicker, a third TE). Never surface those as a suggestion — with an
     exhausted board they would otherwise float to the top by default.        */
  function recommend(ctx, limit) {
    var scored = ctx.available.map(function (p) { return scorePlayer(p, ctx); });
    scored.sort(function (a, b) { return b.score - a.score; });
    var viable = scored.filter(function (r) { return r.score > 0.0001; });
    var top = viable.slice(0, limit || 5);
    top.forEach(function (r) { r.why = explain(r, ctx); });
    return { top: top, all: scored, viable: viable.length };
  }

  /* Who survives to your next turn (doc Section 6).                          */
  function outlook(ctx, limit) {
    if (!ctx.nextPickNo) return { gone: [], surviving: [] };
    var ranked = ctx.available.slice().sort(function (a, b) { return a.rank - b.rank; });
    var gone = [], surviving = [];
    ranked.forEach(function (p) {
      var s = survival(p, ctx.nextPickNo);
      (s < 0.4 ? gone : surviving).push({ player: p, p: s });
    });
    return { gone: gone.slice(0, limit || 6), surviving: surviving.slice(0, limit || 6) };
  }

  /* Roster warnings shown on the Now screen and Roster tab.                  */
  function warnings(ctx) {
    var w = [], c = ctx.counts, r = ctx.round;
    if ((c.TE || 0) === 0 && r >= 9)  w.push({ level: 'warn', text: 'No TE and it is round ' + r + ' — the position dries up fast.' });
    if ((c.QB || 0) === 0 && r >= 10) w.push({ level: 'warn', text: 'No QB in round ' + r + ' — take one in the next round or two.' });
    if ((c.QB || 0) === 0 && r >= 13) w.push({ level: 'bad',  text: 'STILL no QB. Take one now.' });
    if ((c.RB || 0) < 2 && r >= 6)    w.push({ level: 'warn', text: 'Only ' + (c.RB || 0) + ' RB — you start 2 plus a flex.' });
    if ((c.WR || 0) < 2 && r >= 6)    w.push({ level: 'warn', text: 'Only ' + (c.WR || 0) + ' WR — you start 2 plus a flex.' });
    if ((c.RB || 0) >= 5 && (c.WR || 0) <= 2) w.push({ level: 'warn', text: 'RB-heavy (' + c.RB + ' RB / ' + c.WR + ' WR) — pivot to WR.' });
    if ((c.WR || 0) >= 5 && (c.RB || 0) <= 2) w.push({ level: 'warn', text: 'WR-heavy (' + c.WR + ' WR / ' + c.RB + ' RB) — pivot to RB.' });
    if ((c.K || 0) === 0 && r >= 16)  w.push({ level: 'bad',  text: 'No kicker and this is the last round.' });
    if ((c.DEF || 0) === 0 && r >= 16) w.push({ level: 'bad', text: 'No defense and this is the last round.' });
    if (r >= 10 && r <= 13 && (c.RB || 0) >= 2 && (c.RB || 0) < 5) {
      w.push({ level: 'info', text: 'Depth rounds: grab a backup RB with a path to starting (injury insurance).' });
    }
    return w;
  }

  global.Engine = {
    LEAGUE: LEAGUE, TARGET: TARGET, HARD_CAP: HARD_CAP,
    rawValue: rawValue, survival: survival, scorePlayer: scorePlayer,
    recommend: recommend, outlook: outlook, buildRoster: buildRoster,
    mandatory: mandatory,
    byeLoad: byeLoad, warnings: warnings, roundGate: roundGate
  };
})(window);
