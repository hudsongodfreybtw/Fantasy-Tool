// Run with: node --test letterboxd-ranker/
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./ranker-core.js");

const WATCHED = `Date,Name,Year,Letterboxd URI
2024-01-01,Alpha,2001,https://boxd.it/a
2024-01-02,Bravo,2002,https://boxd.it/b
2024-01-03,"Charlie, Part ""Two""",2003,https://boxd.it/c
2024-01-04,Delta,2004,https://boxd.it/d
2024-01-05,Echo,2005,https://boxd.it/e
2024-01-06,Foxtrot,2006,https://boxd.it/f
`;
const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2024-01-01,Alpha,2001,https://boxd.it/a,5
2024-01-02,Bravo,2002,https://boxd.it/b,3
2024-01-04,Delta,2004,https://boxd.it/d,1
`;

function lib() {
  return R.buildLibrary(R.parseCSV(WATCHED), R.parseCSV(RATINGS));
}
function byTitle(state, t) {
  return Object.values(state.films).find((f) => f.t === t);
}
// Answer every question from a hidden "true" order of titles (best first).
function playOut(state, truth) {
  let guard = 0;
  let pair;
  while ((pair = R.currentPair(state)) && guard++ < 500) {
    const a = truth.indexOf(pair.film.t);
    const b = truth.indexOf(pair.opponent.t);
    R.answer(state, a < b ? "better" : "worse");
  }
  return state;
}

test("parseCSV handles quotes, commas and CRLF", () => {
  const rows = R.parseCSV('Name,Year\r\n"A, ""B""",1999\r\nC,2000\r\n');
  assert.deepEqual(rows, [{ Name: 'A, "B"', Year: "1999" }, { Name: "C", Year: "2000" }]);
});

test("buildLibrary marks rated films as anchors and queues unrated, newest first", () => {
  const s = R.createState(lib());
  const p = R.progress(s);
  assert.equal(p.anchors, 3);
  assert.equal(p.unratedTotal, 3);
  assert.equal(byTitle(s, 'Charlie, Part "Two"').r, null);
  assert.equal(R.currentPair(s).film.t, "Foxtrot");
  assert.deepEqual(s.ranked.map((id) => s.films[id].r), [5, 3, 1]);
});

test("binary insertion follows answers and derives stars between anchors", () => {
  const s = R.createState(lib());
  // Truth: Alpha(5) > Foxtrot > Bravo(3) > Echo > Charlie > Delta(1)
  playOut(s, ["Alpha", "Foxtrot", "Bravo", "Echo", 'Charlie, Part "Two"', "Delta"]);
  assert.equal(R.currentPair(s), null);
  assert.deepEqual(
    s.ranked.map((id) => s.films[id].t),
    ["Alpha", "Foxtrot", "Bravo", "Echo", 'Charlie, Part "Two"', "Delta"]
  );
  const st = R.computeStars(s);
  const star = (t) => st[byTitle(s, t).id].stars;
  assert.equal(star("Foxtrot"), 4); // midway between 5 and 3
  assert.ok(star("Echo") >= star('Charlie, Part "Two"'));
  assert.ok(star("Echo") <= 3 && star('Charlie, Part "Two"') >= 1);
  assert.equal(st[byTitle(s, "Alpha").id].derived, false);
});

test("search stops early once both bounding anchors share a rating", () => {
  const watched = "Date,Name,Year\n" + Array.from({ length: 9 }, (_, i) => `2024-01-0${i + 1},F${i},2000`).join("\n");
  const ratings = "Date,Name,Year,Rating\n" +
    Array.from({ length: 8 }, (_, i) => `2024-01-0${i + 1},F${i},2000,4`).join("\n");
  const s = R.createState(R.buildLibrary(R.parseCSV(watched), R.parseCSV(ratings)));
  // 8 anchors all at 4★; the unrated film needs at most 2 questions
  // (above all of them? below all of them?) before it is settled.
  let asked = 0;
  while (R.currentPair(s)) { R.answer(s, "worse"); asked++; if (asked > 1) break; }
  R.answer(s, "better"); // no-op if already settled
  assert.ok(asked <= 2, `asked ${asked}`);
  // Answering "worse" then "better" lands it inside the 4★ run.
  const s2 = R.createState(R.buildLibrary(R.parseCSV(watched), R.parseCSV(ratings)));
  R.answer(s2, "worse");
  if (R.currentPair(s2)) R.answer(s2, "better");
  assert.equal(R.currentPair(s2), null);
  const f = byTitle(s2, "F8");
  assert.equal(R.computeStars(s2)[f.id].stars, 4);
});

test("tie copies the opponent's stars", () => {
  const s = R.createState(lib());
  const pair = R.currentPair(s);
  R.answer(s, "tie");
  const st = R.computeStars(s);
  assert.equal(st[byTitle(s, pair.film.t).id].stars, st[byTitle(s, pair.opponent.t).id].stars);
});

test("no anchors: stars spread by rank and stay monotonic", () => {
  const titles = Array.from({ length: 40 }, (_, i) => `M${i}`);
  const watched = "Date,Name,Year\n" + titles.map((t, i) => `2024-02-${String(i % 28 + 1).padStart(2, "0")},${t},1990`).join("\n");
  const s = R.createState(R.buildLibrary(R.parseCSV(watched), []));
  playOut(s, titles);
  assert.deepEqual(s.ranked.map((id) => s.films[id].t), titles);
  const st = R.computeStars(s);
  const vals = s.ranked.map((id) => st[id].stars);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] <= vals[i - 1]);
  assert.equal(vals[0], 5);
  assert.ok(vals[vals.length - 1] <= 1.5);
});

test("skip, exclude, requeue and rerank", () => {
  const s = R.createState(lib());
  const first = R.currentPair(s).film.id;
  R.skip(s);
  const second = R.currentPair(s).film.id;
  R.exclude(s);
  assert.deepEqual(s.skipped, [first]);
  assert.deepEqual(s.excluded, [second]);
  playOut(s, ["Alpha", "Bravo", 'Charlie, Part "Two"', "Delta", "Echo", "Foxtrot"]);
  R.requeueSkipped(s);
  assert.equal(R.currentPair(s).film.id, first);
  playOut(s, ["Alpha", "Bravo", 'Charlie, Part "Two"', "Delta", "Echo", "Foxtrot"]);
  const placed = s.ranked.find((id) => !R.isAnchor(s, id));
  R.rerank(s, placed);
  assert.equal(R.currentPair(s).film.id, placed);
  assert.ok(!s.ranked.includes(placed));
});

test("undo snapshot restores the exact position", () => {
  const s = R.createState(lib());
  const snap = R.snapshot(s);
  const before = R.currentPair(s);
  R.answer(s, "better");
  R.restore(s, snap);
  assert.deepEqual(R.currentPair(s), before);
});

test("export lists only derived ratings in Letterboxd import format", () => {
  const s = R.createState(lib());
  playOut(s, ["Alpha", "Foxtrot", "Bravo", "Echo", 'Charlie, Part "Two"', "Delta"]);
  const csv = R.exportCSV(s).trim().split("\n");
  assert.equal(csv[0], "LetterboxdURI,Title,Year,Rating");
  assert.equal(csv.length, 4);
  assert.ok(csv.includes('https://boxd.it/c,"Charlie, Part ""Two""",2003,' + R.computeStars(s)[byTitle(s, 'Charlie, Part "Two"').id].stars));
  assert.ok(!csv.some((l) => l.includes("Alpha")));
});
