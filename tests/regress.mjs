import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((q,s)=>{const p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);return s.end();}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});
await new Promise(r=>server.listen(8096,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errs=[]; let ok=0, fail=0;
const check=(name,cond,extra='')=>{ if(cond){ok++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+' '+extra);} };

// MANUAL MODE: no network at all to sleeper
await ctx.route('**/api.sleeper.app/**', r=>r.abort());
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
// In manual mode we deliberately abort every Sleeper call, so the browser logs
// a network failure for each. That is the scenario under test, not a bug.
page.on('console',m=>{ if(m.type()==='error' && !/ERR_FAILED|Failed to load resource/.test(m.text()))
  errs.push('CONSOLE: '+m.text()); });
await page.goto('http://127.0.0.1:8096/index.html'); await page.waitForTimeout(1500);

console.log('\n[manual mode — sleeper unreachable]');
check('app renders a shortlist anyway', (await page.$$('.rec')).length===5);
check('status chip is not "Live"', !(await page.textContent('#syncLabel')).includes('Live'));
check('pick 1 shown', (await page.textContent('#pickLabel')).includes('Pick 1'));

// mark 6 players drafted by tapping the board
await page.click('[data-view="board"]'); await page.waitForTimeout(400);
for (let i=0;i<6;i++){
  await page.click('.prow'); await page.waitForTimeout(150);
  const btns = await page.$$('.sheet .opt');
  await btns[1].click();            // "Another team drafted him"
  await page.waitForTimeout(200);
}
await page.click('[data-view="now"]'); await page.waitForTimeout(400);
check('6 manual picks advanced the clock to pick 7', (await page.textContent('#pickLabel')).includes('Pick 7'));
check('it is my turn at pick 7', (await page.textContent('#turnText'))==='YOUR PICK');
const top=await page.$$eval('.rec-name',e=>e.map(x=>x.textContent));
console.log('    shortlist:', top.join(' | '));
check('doc predicted JSN / St. Brown / Cook at pick 7',
      top.slice(0,3).some(n=>n.includes('Smith-Njigba')) && top.slice(0,3).some(n=>n.includes('Cook')), top.join(','));

// undo
await page.click('[data-view="draft"]'); await page.waitForTimeout(300);
await page.click('#btnUndo'); await page.waitForTimeout(300);
check('undo rolls the pick back', (await page.textContent('#pickLabel')).includes('Pick 6'));

// unknown pick
await page.click('#btnUnknown'); await page.waitForTimeout(300);
check('unknown-pick button advances counter', (await page.textContent('#pickLabel')).includes('Pick 7'));

// importers
await page.click('#btnPasteRanks'); await page.waitForTimeout(300);
await page.fill('.sheet textarea','1. Bijan Robinson RB ATL 11\n2. Ja\'Marr Chase WR CIN 6\n3. Puka Nacua WR LAR 11');
await page.click('.sheet .opt.go'); await page.waitForTimeout(400);
const msg=await page.textContent('.sheet .hint');
check('rankings import reports success', /Imported 3 players/.test(msg), msg);
await page.click('.sheet button[data-close]'); await page.waitForTimeout(300);

await page.click('#btnByes'); await page.waitForTimeout(300);
await page.fill('.sheet textarea','ARI 8\nCLE 9');
await page.click('.sheet .opt.go'); await page.waitForTimeout(300);
check('bye import reports success', /Saved 2 bye weeks/.test(await page.textContent('.sheet .hint')));
await page.click('.sheet button[data-close]'); await page.waitForTimeout(300);

// reset first so the note test targets a player who is definitely available
await page.click('#btnReset'); await page.waitForTimeout(300);
await page.click('.sheet .opt'); await page.waitForTimeout(400);
check('reset clears the pick log', (await page.textContent('#pickLabel')).includes('Pick 1'));

await page.click('#btnPasteNotes'); await page.waitForTimeout(300);
await page.fill('.sheet textarea','Bijan Robinson | injury | ankle, limited in practice');
await page.click('.sheet .opt.go'); await page.waitForTimeout(300);
check('notes import reports success', /Imported 1 notes/.test(await page.textContent('.sheet .hint')));
await page.click('.sheet button[data-close]'); await page.waitForTimeout(400);

// Raw-rank board: the pasted list must sit at the top.
await page.click('[data-view="board"]'); await page.waitForTimeout(400);
await page.uncheck('#sortValue'); await page.waitForTimeout(400);
const rawFirst = await page.textContent('.prow .prow-name');
check('pasted rankings take over the top of the raw board', /Bijan/.test(rawFirst), rawFirst);

// The flagged player must carry a visible injury badge...
const bijanBadge = await page.$eval('.prow:has-text("Bijan Robinson")',
  e => [...e.querySelectorAll('.badge')].map(b=>b.textContent).join(','));
check('injury badge shows on the board row', /injury/.test(bijanBadge), bijanBadge);

// ...and the note text must be readable on tap.
await page.click('.prow:has-text("Bijan Robinson")'); await page.waitForTimeout(300);
check('note text is readable in the player sheet',
      /ankle, limited in practice/.test(await page.textContent('#sheetContent')));
await page.click('.sheet button[data-close]'); await page.waitForTimeout(300);

// ...and it must actually demote him once fit-sorted.
await page.check('#sortValue'); await page.waitForTimeout(400);
const fitFirst = await page.textContent('.prow .prow-name');
check('injury flag demotes him below the top of the fit-sorted board', !/Bijan/.test(fitFirst), fitFirst);

// persistence across reload
await page.click('[data-view="now"]'); await page.waitForTimeout(300);
await page.click('.rec.top .rec-take'); await page.waitForTimeout(400);
const before = await page.textContent('#pickLabel');
await page.reload(); await page.waitForTimeout(1300);
check('state survives a reload', (await page.textContent('#pickLabel'))===before, before+' -> '+(await page.textContent('#pickLabel')));

// all four tabs render
for (const v of ['now','board','roster','draft']) {
  await page.click(`[data-view="${v}"]`); await page.waitForTimeout(350);
  check(`tab "${v}" renders`, await page.isVisible(`#view-${v}`));
}
// tap-through: is anything invisibly blocking?
await page.click('[data-view="now"]'); await page.waitForTimeout(300);
check('no invisible overlay blocking taps', await page.isVisible('#view-now'));

console.log('\n[js errors]', errs.length?errs:'none');
console.log(`\n${ok} passed, ${fail} failed, ${errs.length} js errors`);
await browser.close(); server.close();
process.exit(fail || errs.length ? 1 : 0);
