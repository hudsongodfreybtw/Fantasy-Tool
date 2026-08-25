import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(8099, r));

// ---- fake Sleeper draft -----------------------------------------------------
const DRAFT_ID = '99887766';
const board = JSON.parse(fs.readFileSync(process.argv[2] || '/dev/null', 'utf8').trim() || '[]');
let picks = [];
const meta = (name, pos, team) => {
  const [first, ...rest] = name.split(' ');
  return { first_name: first, last_name: rest.join(' '), position: pos, team };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
await ctx.route('**/api.sleeper.app/**', async (route) => {
  const url = route.request().url();
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (url.includes('/league/') && url.endsWith('/drafts'))
    return json([{ draft_id: DRAFT_ID, season: '2026', status: 'drafting', start_time: 1,
                   settings: { teams: 12, rounds: 16, pick_timer: 60 },
                   draft_order: { 'U_HUD': 7 } }]);
  if (url.endsWith('/league/1389737725439004672'))
    return json({ name: 'Degenerates', league_id: '1389737725439004672', total_rosters: 12, season: '2026' });
  if (url.includes('/draft/') && url.endsWith('/picks'))
    return json(picks);
  if (url.includes('/user/')) return json({ user_id: 'U_HUD', username: 'hudgod' });
  if (url.endsWith('/players/nfl')) return json({});
  return json({});
});

const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:8099/index.html');
await page.waitForTimeout(1200);

// Turn on auto-sync via the UI, then connect.
await page.click('[data-view="draft"]');
await page.check('#fAuto');
await page.click('#btnConnect');
await page.waitForTimeout(1500);
console.log('sync status:', await page.textContent('#syncStatusLine'));

// --- feed the first 6 picks, exactly the doc's expectation for pick 7 -------
const first6 = [
  ['Jahmyr Gibbs','RB','DET'], ['Bijan Robinson','RB','ATL'], ["Ja'Marr Chase",'WR','CIN'],
  ['Puka Nacua','WR','LAR'], ['Jonathan Taylor','RB','IND'], ['Christian McCaffrey','RB','SF']
];
picks = first6.map((p, i) => ({ pick_no: i+1, round: 1, draft_slot: i+1, player_id: 'x'+i, metadata: meta(...p) }));
await page.waitForTimeout(3500);

await page.click('[data-view="now"]');
await page.waitForTimeout(600);
console.log('\ntopbar:', (await page.textContent('.where')).replace(/\s+/g,' '), '|', await page.textContent('#turnText'));
console.log('clock :', await page.textContent('#clockMain'));
const recs = await page.$$eval('.rec', els => els.map(e => ({
  name: e.querySelector('.rec-name').textContent,
  why: e.querySelector('.rec-why').textContent
})));
console.log('\nTOP 5 AT PICK 7:');
recs.forEach((r,i) => console.log(`  ${i+1}. ${r.name.padEnd(24)} ${r.why}`));
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/now-pick7.png', fullPage: true });

// --- expand a card, take a player ------------------------------------------
await page.click('.rec.top .rec-main');
await page.waitForTimeout(400);
console.log('\nexpanded detail rows:', await page.$$eval('.rec-detail tr td:first-child', e=>e.map(x=>x.textContent)));
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/now-expanded.png', fullPage: true });

await page.click('.rec.top .rec-take');
await page.waitForTimeout(600);
console.log('after taking #1 -> turn text:', await page.textContent('#turnText'));

// --- board + roster + draft screenshots ------------------------------------
await page.click('[data-view="board"]'); await page.waitForTimeout(600);
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/board-all.png', fullPage: false });
await page.click('.chip[data-pos="RB"]'); await page.waitForTimeout(400);
await page.uncheck('#sortValue'); await page.waitForTimeout(400);
console.log('\nRB board tier headers:', await page.$$eval('.tierhead', e=>e.slice(0,4).map(x=>x.textContent.replace(/\s+/g,' '))));
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/board-rb-tiers.png', fullPage: false });

await page.click('[data-view="roster"]'); await page.waitForTimeout(600);
console.log('roster slots:', await page.$$eval('.slot', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()).slice(0,4)));
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/roster.png', fullPage: true });

await page.click('[data-view="draft"]'); await page.waitForTimeout(400);
await page.screenshot({ path: (process.env.SHOT||'/tmp') + '/draft-tab.png', fullPage: true });

console.log('\n=== JS ERRORS ===', errors.length ? errors : 'none');
await browser.close(); server.close();
