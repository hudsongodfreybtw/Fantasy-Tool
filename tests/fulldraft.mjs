import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((q,s)=>{let p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p,(e,b)=>{ if(e){s.writeHead(404);return s.end();} s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});
await new Promise(r=>server.listen(8098,r));

// Realistic-ish player universe: the doc's 93 + generated depth, K and DEF.
const board = (await import('node:fs')).readFileSync(path.join(ROOT,'data/board.js'),'utf8');
const w={}; new Function('window', board)(w);
const universe = w.BOARD_DATA.players.map(p=>({name:p.name,pos:p.pos,team:p.team||'FA',adp:p.rank}));
let adp=94;
const gen=(pre,pos,n)=>{for(let i=1;i<=n;i++) universe.push({name:`${pre} ${i}`,pos,team:'FA',adp:adp++});};
gen('Depth RB','RB',40); gen('Depth WR','WR',50); gen('Depth TE','TE',18); gen('Depth QB','QB',18);
for(let i=1;i<=18;i++) universe.push({name:`Kicker ${i}`,pos:'K',team:'FA',adp:250+i});
for(let i=1;i<=18;i++) universe.push({name:`Team ${i} D/ST`,pos:'DEF',team:'FA',adp:270+i});

const DRAFT='555'; let picks=[]; const taken=new Set();
const oppNeeds={}; for(let s=1;s<=12;s++) oppNeeds[s]={QB:0,RB:0,WR:0,TE:0,K:0,DEF:0};
function oppPick(slot, round){
  const c=oppNeeds[slot];
  const ok=p=>{ if(taken.has(p.name)) return false;
    if(p.pos==='K') return round>=14&&c.K<1; if(p.pos==='DEF') return round>=13&&c.DEF<1;
    if(p.pos==='QB') return (round>=5&&c.QB<1)||(round>=12&&c.QB<2);
    if(p.pos==='TE') return c.TE<2; return c[p.pos]<6; };
  let pool=universe.filter(ok); if(!pool.length) pool=universe.filter(p=>!taken.has(p.name));
  pool.sort((a,b)=>a.adp-b.adp);
  // small randomness so it isn't a pure ADP march
  const pick=pool[Math.min(pool.length-1, Math.floor(Math.random()*Math.min(4,pool.length)))];
  taken.add(pick.name); c[pick.pos]++; return pick;
}
function push(pickNo, slot, p){
  const [f,...r]=p.name.split(' ');
  picks.push({pick_no:pickNo, round:Math.ceil(pickNo/12), draft_slot:slot, player_id:p.name,
              metadata:{first_name:f,last_name:r.join(' '),position:p.pos,team:p.team}});
}

const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errs=[];
await ctx.route('**/api.sleeper.app/**', r=>{ const u=r.request().url();
  const j=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if(u.includes('/league/')&&u.endsWith('/drafts')) return j([{draft_id:DRAFT,season:'2026',status:'drafting',start_time:1,settings:{teams:12,rounds:16,pick_timer:60},draft_order:{U:7}}]);
  if(u.includes('/draft/')&&u.endsWith('/picks')) return j(picks);
  if(u.includes('/user/')) return j({user_id:'U',username:'hudgod'});
  if(u.endsWith('/players/nfl')){ const o={}; universe.forEach((p,i)=>{ const [f,...r]=p.name.split(' ');
    o['id'+i]={player_id:'id'+i, first_name:f, last_name:r.join(' '), position:p.pos, team:p.team==='FA'?'BUF':p.team,
               search_rank:p.adp, status:'Active'}; }); return j(o); }
  return j({}); });
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text());});
await page.goto('http://127.0.0.1:8098/index.html');
await page.waitForTimeout(800);
await page.click('[data-view="draft"]');
await page.click('#btnPlayers'); await page.waitForTimeout(2500);
console.log('data:', await page.textContent('#dataStatusLine'));
await page.check('#fAuto'); await page.click('#btnConnect');
await page.waitForTimeout(1200); await page.click('[data-view="now"]');

const mine=[];
for(let pn=1; pn<=192; pn++){
  const slot=((Math.ceil(pn/12)%2)===1)?((pn-1)%12)+1:12-((pn-1)%12);
  const round=Math.ceil(pn/12);
  if(slot===7){
    await page.waitForFunction(n=>document.querySelector('#pickLabel').textContent==='Pick '+n, pn, {timeout:15000});
    await page.waitForTimeout(120);
    const top=await page.$$eval('.rec',e=>e.slice(0,3).map(x=>({n:x.querySelector('.rec-name').textContent,
      w:x.querySelector('.rec-why').textContent, p:x.querySelector('.pos').textContent})));
    if(!top.length){ console.log(`R${round} p${pn} NO RECOMMENDATION`); continue; }
    await page.click('.rec.top .rec-take');
    taken.add(top[0].n);
    push(pn,7,{name:top[0].n,pos:top[0].p,team:'FA'});
    mine.push({round,pn,...top[0], alts:top.slice(1).map(t=>t.n)});
    await page.waitForTimeout(60);
  } else {
    push(pn,slot,oppPick(slot,round));
  }
}
await page.waitForTimeout(3500);
console.log('=== MY 16 PICKS (driven through the real UI) ===');
mine.forEach(m=>console.log(`R${String(m.round).padStart(2)} p${String(m.pn).padStart(3)} ${m.p.padEnd(3)} ${m.n.padEnd(23)}| ${m.w}`));
await page.click('[data-view="roster"]'); await page.waitForTimeout(800);
console.log('\nSTARTERS:'); 
console.log((await page.$$eval('.slot',e=>e.map(x=>'  '+x.textContent.replace(/\s+/g,' ').trim()))).join('\n'));
console.log('BENCH:', await page.$$eval('.benchrow',e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
console.log('\nSUMMARY:', await page.$$eval('#summary .statusline',e=>e.map(x=>x.textContent)));
console.log('\nERRORS:', errs.length?errs:'none');
await page.screenshot({path:(process.env.SHOT||'/tmp')+'/final-roster.png',fullPage:true});
await browser.close(); server.close();
