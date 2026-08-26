import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((q,s)=>{const p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p,(e,b)=>{if(e){s.writeHead(404);return s.end();}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});
await new Promise(r=>server.listen(8094,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await ctx.route('**/api.sleeper.app/**', r=>r.abort());
const errs=[]; let ok=0,fail=0;
const check=(n,c,x='')=>{ if(c){ok++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+'  '+x);} };
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|Failed to load resource/.test(m.text()))errs.push('CONSOLE: '+m.text());});
await page.goto('http://127.0.0.1:8094/index.html'); await page.waitForTimeout(1200);

// Put a "real" pick on the board first, so we can prove it survives practice.
await page.click('[data-view="board"]'); await page.waitForTimeout(400);
await page.click('.prow'); await page.waitForTimeout(250);
let opts=await page.$$('.sheet .opt'); await opts[1].click(); await page.waitForTimeout(300);
const realPickCount = await page.evaluate(()=>State.S.picks.length);
check('a real pick exists before practice', realPickCount===1);

// Start practice
await page.click('[data-view="draft"]'); await page.waitForTimeout(300);
await page.click('#btnDemo'); await page.waitForTimeout(300);
await page.click('.sheet .opt.go'); await page.waitForTimeout(400);
check('banner announces practice mode', /PRACTICE DRAFT/.test(await page.textContent('#banner')));
check('status chip reads Practice', (await page.textContent('#syncLabel'))==='Practice');
check('board was cleared for practice', (await page.evaluate(()=>State.S.picks.length))<3);

// Opponents should draft themselves up to pick 7 and then stop.
await page.click('[data-view="now"]');
await page.waitForFunction(()=>document.querySelector('#turnText').textContent==='YOUR PICK',null,{timeout:20000});
const pickNo = await page.textContent('#pickLabel');
check('opponents drafted up to your turn on their own', pickNo.includes('Pick 7'), pickNo);
check('and then stopped there', await page.evaluate(async()=>{
  const before=State.currentPickNo(); await new Promise(r=>setTimeout(r,2500));
  return State.currentPickNo()===before; }));
const shortlist=await page.$$eval('.rec-name',e=>e.map(x=>x.textContent));
check('shortlist is live during practice', shortlist.length===5, shortlist.join(','));
console.log('    round 1 shortlist:', shortlist.join(' | '));
check('clock is counting', /\d:\d\d/.test(await page.textContent('#clockMain')), await page.textContent('#clockMain'));
await page.screenshot({path:(process.env.SHOT||'/tmp')+'/practice.png',fullPage:false});

// Make three of my own picks; opponents should resume in between each time.
for (let i=0;i<3;i++){
  await page.click('.rec.top .rec-take');
  await page.waitForFunction(()=>document.querySelector('#turnText').textContent==='YOUR PICK',null,{timeout:25000});
}
const after=await page.textContent('#pickLabel');
check('practice advanced through 4 rounds', after.includes('Pick 42'), after);
await page.click('[data-view="roster"]'); await page.waitForTimeout(500);
const filled=await page.$$eval('.slot:not(.empty) .slot-name',e=>e.map(x=>x.textContent));
check('roster filled with my 3 practice picks', filled.length===3, filled.join(','));
console.log('    my practice roster:', filled.join(' | '));

// Stop practice -> real pick comes back
await page.click('[data-view="draft"]'); await page.waitForTimeout(300);
await page.click('#btnDemo'); await page.waitForTimeout(600);
check('practice banner gone', await page.getAttribute('#banner','hidden')!==null || !/PRACTICE/.test(await page.textContent('#banner')));
check('real draft restored exactly', (await page.evaluate(()=>State.S.picks.length))===1,
      'picks='+(await page.evaluate(()=>JSON.stringify(State.S.picks.map(p=>p.name)))));

console.log('\n[js errors]', errs.length?errs:'none');
console.log(`\n${ok} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail||errs.length?1:0);
