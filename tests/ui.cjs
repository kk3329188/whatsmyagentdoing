// Browser integration checks with fixed sample sessions (no private logs).
// Requires Google Chrome; WMAD_HEADED=1 opens visible test windows.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.WMAD_NO_UPDATE_CHECK = '1';
const { DemoWatcher } = require('../src/demo');
const { createServer } = require('../src/server');
const screenshots = process.env.WMAD_SCREENSHOTS;
async function screenshot(page, name) {
  if (!screenshots) return;
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, name + '.png') });
}
const checks=[];
const check=(name)=>{checks.push(name);console.log('PASS',name)};
const sessions = [
 {key:'claude:one', id:'one', agent:'claude',project:'claude-project',status:'thinking'},
 {key:'codex:two', id:'two', agent:'codex',project:'codex-project',status:'waiting'},
 {key:'gemini:three', id:'three', agent:'gemini',project:'gemini-project',status:'tool',activity:'Read: index.js'},
 {key:'claude:done', id:'done', agent:'claude',project:'finished-project',status:'done'},
 {key:'codex:sub', id:'sub', agent:'codex',project:'sub-project',status:'thinking',subagent:true},
].map(s=>({...s,lastEventAt:Date.now(),turnStartedAt:Date.now()-1000,cwd:'/demo/'+s.project}));
async function stable(page){
 await page.waitForFunction(()=>typeof office!=='undefined' && office?.framesShown>4);
 await page.evaluate(s=>{window.__events?.close();onData({now:Date.now(),sessions:s})},sessions);
}
async function openSettings(page) {
 if (!(await page.locator('#settingsMenu').getAttribute('open') !== null)) await page.click('#settingsMenu > summary');
}
async function badges(target){
 return target.evaluate(()=>{
  const found=[];const original=office.agentBadge;
  office.agentBadge=function(a,...rest){found.push(a.short);return original.call(this,a,...rest)};
  office.frame(performance.now());office.agentBadge=original;return found;
 });
}
async function drawnLogos(target) {
 await target.waitForFunction(()=>Object.values(OFFICE_AGENT_BADGES).every(b=>b.image.complete&&b.image.naturalWidth>0));
 return target.evaluate(()=>{
  const found=new Set();const ctx=office.ctx;const original=ctx.drawImage;
  ctx.drawImage=function(img,...args){
   for(const [key,badge] of Object.entries(OFFICE_AGENT_BADGES)) if(img===badge.image) found.add(key);
   return original.call(this,img,...args);
  };
  try {office.frame(performance.now());} finally {ctx.drawImage=original;}
  return [...found].sort();
 });
}
(async()=>{
 const watcher = new DemoWatcher().start();
 const server = createServer(watcher, { demo: true, privacy: false });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 const base = `http://127.0.0.1:${server.address().port}`;
 let browser;
 const errors=[];
 try {
  const translations = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8'), translations);
  const keys = Object.keys(translations.window.I18N.en).sort();
  for (const lang of Object.values(translations.window.I18N)) assert.deepEqual(Object.keys(lang).sort(), keys);
  check('all nine languages provide every UI string');
  browser=await chromium.launch({headless:process.env.WMAD_HEADED !== '1',channel:'chrome',ignoreDefaultArgs:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],args:['--window-size=1280,960']});
  const context=await browser.newContext({viewport:{width:1280,height:960},locale:'en-US'});
  await context.addInitScript(sessions=>{
   window.EventSource=class {constructor(){window.__events=this;setTimeout(()=>{if(!this.closed)this.onmessage?.({data:JSON.stringify({now:Date.now(),sessions})})},0)}close(){this.closed=true}};
   window.__notifications=[];
   Date.prototype.getHours=function(){return 15}; // daytime, whatever the real clock says (after hours sends idle people home)
   window.Notification=class {static permission='granted';constructor(title,options){window.__notifications.push({title,options})}};
  },sessions);
  context.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
  const page=await context.newPage();await page.goto(base);await stable(page);
  assert.equal(await page.locator('h1 [data-t]').innerText(),"What's my agent doing");
  assert.equal(await page.locator('#showAgent').isChecked(),true);
  assert.deepEqual([...new Set(await badges(page))].sort(),['Cl','Cx','G']);
  assert.deepEqual(await drawnLogos(page),['claude','codex','gemini']);
  assert.equal(await page.locator('#agentLegend img').evaluateAll(imgs=>imgs.length===3&&imgs.every(img=>img.complete&&img.naturalWidth>0)),true);
  check('all official local logos load and draw in 2D and the legend');
  await openSettings(page);await page.check('#showSub');
  assert.equal((await badges(page)).length,5);
  check('2D badges identify all three providers and subagents without duplicate activity badges');
  await openSettings(page);await page.uncheck('#showAgent');assert.equal((await badges(page)).length,0);
  assert.equal(await page.locator('#agentLegend').isVisible(),false);
  await page.reload();await stable(page);assert.equal(await page.locator('#showAgent').isChecked(),false);
  await openSettings(page);await page.check('#showAgent');check('badge toggle hides markers and legend and persists across reload');
  // The floors are stacked like the building: 2F stands on posts over 1F.
  // Looking at 1F, 2F has floated up out of the box; picking 2F brings it down
  // over 1F, whose camera slides under it, so 1F still shows underneath.
  const floorsNow=()=>page.evaluate(()=>{const box=officeEl.getBoundingClientRect();return {floor:state.floor,stack:officeEl.classList.contains('stack'),visible:[office.visible,office2.visible],
   top:floorRoots.map(r=>r.getBoundingClientRect().top-box.top),h:box.height,z:floorRoots.map(r=>+getComputedStyle(r).zIndex||0),shown:floorRoots.map(r=>getComputedStyle(r).visibility)}});
  const settled=(n)=>page.waitForFunction(n=>state.floor===n&&office.visible&&office2.visible===(n===2)&&!officeEl.classList.contains('moving'),n,{timeout:5000});
  // Where 1F's post tops (wall 2.4 + gap 2.4) and 2F's floor are on screen.
  const meet=()=>page.evaluate(()=>{const y=(o,z)=>o.iso(0,0,z).y*o.cam.zoom+o.cam.oy;return {wallTop1:y(office,4.8),floor2:y(office2,0),beneath:office.beneath===office2}});
  await page.keyboard.press('1');await settled(1);
  let fl=await floorsNow();
  assert.ok(fl.stack&&Math.abs(fl.top[0])<2&&fl.top[1]<=-fl.h,JSON.stringify(fl));
  assert.ok(fl.z[1]>fl.z[0],'2F is the floor on top');
  await page.click('.floor-tabs [data-floor="2"]');
  const mid=await page.evaluate(async()=>{await new Promise(r=>setTimeout(r,250));const box=officeEl.getBoundingClientRect();return {t:floorRoots[1].getBoundingClientRect().top-box.top,v:[office.visible,office2.visible]}});
  assert.ok(mid.t<-1&&mid.t>-fl.h&&mid.v.every(Boolean),`2F on its way down, both drawn: ${JSON.stringify(mid)}`);
  await page.waitForTimeout(500);
  const m=await meet();
  assert.ok(m.beneath&&Math.abs(m.wallTop1-m.floor2)<1,`2F's floor lands on 1F's posts: ${JSON.stringify(m)}`);
  await settled(2);fl=await floorsNow();
  assert.ok(Math.abs(fl.top[1])<2&&fl.shown[0]==='visible'&&fl.visible.every(Boolean),'2F stands over 1F, and 1F is still drawn under it');
  // Someone downstairs, in view under 2F, opens on a click too.
  const down=await page.waitForFunction(()=>{const r=office.canvas.getBoundingClientRect();for(const h of office.hit){const p=office.people.get(h.key);if(!p||p.path.length)continue;const x=r.left+(h.x0+h.x1)/2,y=r.top+(h.y0+h.y1)/2;if(!office2.onFloorAt(x,y)&&!office2.hit.some(b=>x-r.left>=b.x0&&x-r.left<=b.x1&&y-r.top>=b.y0&&y-r.top<=b.y1))return {x,y}}return null},{},{timeout:20000}).then(h=>h.jsonValue());
  await page.evaluate(()=>Hub.close&&Hub.close());
  await page.mouse.click(down.x,down.y);
  await page.waitForFunction(()=>{const p=document.querySelector('.hub-panel');return p&&!p.hidden&&p.getClientRects().length>0});
  await page.evaluate(()=>Hub.close&&Hub.close());
  const walls=await page.evaluate(()=>{let n=0;const f=office2.storeyBelow;office2.storeyBelow=function(){n++;return f.call(this)};office2.frame(performance.now());office2.storeyBelow=f;return n});
  assert.equal(walls,1,'2F draws its slab and posts');
  // Someone on 2F can be clicked open (the demo keeps everyone downstairs, so move one up).
  await page.evaluate(()=>{Hub.close&&Hub.close();OfficeFloors.split=((split)=>(list,prev,o)=>{const r=split(list,prev,o);const f=r.floors.get('claude:done');if(f)r.floors.set('claude:done',{...f,floor:2});return r})(OfficeFloors.split);render()});
  const who=await page.waitForFunction(()=>{const p=office2.people.get('claude:done');if(!p||p.path.length)return null;const r=office2.canvas.getBoundingClientRect();const h=office2.hit.find(b=>b.key==='claude:done');return h&&{x:r.left+(h.x0+h.x1)/2,y:r.top+(h.y0+h.y1)/2}},{},{timeout:20000}).then(h=>h.jsonValue());
  await page.mouse.click(who.x,who.y);
  await page.waitForFunction(()=>{const p=document.querySelector('.hub-panel');return p&&!p.hidden&&p.getClientRects().length>0});
  await page.evaluate(()=>Hub.close&&Hub.close());
  await page.keyboard.press('1');await settled(1);fl=await floorsNow();
  assert.ok(fl.top[1]<=-fl.h&&fl.shown[0]==='visible'&&!(await meet()).beneath,'2F floated back up, 1F on its own');
  await page.reload();await stable(page);
  check('floors stack: 2F comes down over 1F on posts, 1F stays in view under it, both floors\' people open on click, 2F floats up again');
  await page.click('#qualSeg [data-v=high]');
  await page.waitForFunction(()=>officeKind==='high:office'&&office?.loaded&&office.framesShown>4,{},{timeout:30000});
  assert.deepEqual([...new Set(await badges(page))].sort(),['Cl','Cx','G']);
  await screenshot(page, 'office-3d');
  assert.deepEqual(await drawnLogos(page),['claude','codex','gemini']);
  check('3D renders the same official provider logos');
  await page.click('#pipBtn');await page.waitForFunction(()=>!!popout.win);
  const pip=context.pages().find(p=>p!==page);assert.ok(pip);
  const frame=await (async()=>{for(let i=0;i<100;i++){const f=pip.frames().find(f=>f.url().includes('?pip=1'));if(f)return f;await new Promise(r=>setTimeout(r,50))}throw Error('No compact frame')})();
  await frame.waitForFunction(()=>office?.loaded&&office.framesShown>4);
  await frame.evaluate(s=>{window.__events?.close();onData({now:Date.now(),sessions:s})},sessions);
  assert.deepEqual(await drawnLogos(frame),['claude','codex','gemini']);
  assert.equal(await page.evaluate(()=>office.visible),false);
  assert.equal(await frame.evaluate(()=>state.quality),'high');
  assert.equal(await frame.locator('#pipBtn').isVisible(),false);
  await pip.setViewportSize({width:480,height:400});
  await frame.waitForFunction(()=>!document.getElementById('office').classList.contains('loading'));await page.waitForTimeout(400);await screenshot(pip, 'pip-3d');
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  check('real Document PiP opens 3D at compact size and suspends the main office');
  await openSettings(page);await page.uncheck('#showAgent');await frame.waitForFunction(()=>!state.showAgent&&!office.showAgent);
  await openSettings(page);await page.selectOption('#langSel','zh-TW');await frame.waitForFunction(()=>langCode==='zh-TW');
  await openSettings(page);await page.click('#agentSeg [data-v=codex]');await frame.waitForFunction(()=>state.agent==='codex');
  await frame.click('#viewSeg [data-v=list]');await page.waitForFunction(()=>state.view==='list');
  assert.equal(await frame.locator('section').count(),2);
  assert.equal(await frame.locator('.card[data-s=done]').count(),0);
  assert.equal(await frame.locator('.card .agent.claude').count(),0);
  assert.equal(await frame.locator('.card .agent img').evaluateAll(imgs=>imgs.length>0&&imgs.every(img=>img.complete&&img.naturalWidth>0)),true);
  await screenshot(pip, 'pip-list');
  check('preferences synchronize in both directions; compact list shows only attention/working sessions');
  const next=sessions.map(s=>s.key==='codex:sub'?{...s,status:'done',subagent:false}:s);
  await frame.evaluate(s=>onData({now:Date.now(),sessions:s}),next);
  await page.evaluate(s=>onData({now:Date.now(),sessions:s}),next);
  assert.equal(await frame.evaluate(()=>__notifications.length),0);
  assert.equal(await page.evaluate(()=>__notifications.length),1);
  check('only the main page emits completion notifications');
  await openSettings(page);await page.click('#agentSeg [data-v=all]');
  await frame.click('#viewSeg [data-v=office]');await openSettings(page);await page.check('#showAgent');await frame.click('#qualSeg [data-v=mid]');
  await frame.waitForFunction(()=>officeKind==='mid'&&office.framesShown>4);
  await page.waitForFunction(()=>state.quality==='mid');
  const foreground=await context.newPage();await foreground.goto('about:blank');await foreground.bringToFront();
  const before=await frame.evaluate(()=>({frames:office.framesShown,visible:document.visibilityState}));
  await new Promise(r=>setTimeout(r,1100));
  const after=await frame.evaluate(()=>({frames:office.framesShown,visible:document.visibilityState}));
  assert.ok(after.frames>before.frames,JSON.stringify({before,after}));
  await foreground.close();check('pop-out keeps animating while another tab is foreground');
  await pip.close();await page.waitForFunction(()=>!popout.win&&office.visible);
  await page.bringToFront();await page.waitForFunction(()=>office.framesShown>4);
  await page.click('#pipBtn');await page.waitForFunction(()=>!!popout.win);
  await page.click('#pipBtn');await page.waitForFunction(()=>!popout.win&&office.visible);
  check('native close and button close restore the main view; reopening works');
  await page.evaluate(()=>{documentPictureInPicture.requestWindow=()=>Promise.reject(new Error('Test rejection'))});
  await page.click('#pipBtn');await page.waitForFunction(()=>!popout.busy&&!document.getElementById('pipError').hidden);
  assert.equal(await page.evaluate(()=>office.visible),true);
  assert.equal(await page.locator('#pipBtn').isEnabled(),true);
  check('request failure gives a translated error and leaves the dashboard usable');
  // Force only the capability branch; rendering and MediaStream remain real.
  const fallback=await context.newPage();
  await fallback.addInitScript(()=>Object.defineProperty(window,'documentPictureInPicture',{value:undefined}));
  await fallback.goto(base+'/?view=office&quality=high');await stable(fallback);
  await fallback.waitForFunction(()=>office.loaded&&office.framesShown>4);
  await fallback.click('#pipBtn');
  await fallback.waitForFunction(()=>!!popout.stream&&!popout.busy&&document.getElementById('pipVideo').videoWidth>0);
  assert.equal(await fallback.locator('#pipPreview').isVisible(),true);
  const colors=await fallback.evaluate(()=>{
   const data=popout.captureContext.getImageData(0,0,960,540).data;const values=new Set();
   for(let i=0;i<data.length;i+=160)values.add(`${data[i]},${data[i+1]},${data[i+2]}`);
   window.__stream=popout.stream;return values.size;
  });
  assert.ok(colors>20,'preview includes rendered 3D content rather than a blank frame');
  await fallback.click('#qualSeg [data-v=mid]');await fallback.waitForFunction(()=>officeKind==='mid'&&office.framesShown>4);
  assert.equal(await fallback.evaluate(()=>popout.stream===__stream),true);
  await fallback.click('#closePreview');await fallback.waitForFunction(()=>!popout.stream);
  assert.equal(await fallback.evaluate(()=>__stream.getTracks().every(t=>t.readyState==='ended')),true);
  assert.equal(await fallback.evaluate(()=>document.getElementById('pipVideo').srcObject),null);
  check('video fallback captures 3D + overlay, survives renderer changes and releases media tracks on stop');
  await fallback.click('#viewSeg [data-v=list]');assert.equal(await fallback.locator('#pipBtn').isVisible(),false);
  check('view-only fallback is offered only for office mode');
  const compact=await context.newPage();await compact.goto(base+'/?pip=1&view=list');
  await compact.waitForFunction(()=>state.loaded);
  await compact.evaluate(()=>{__events.close();onData({now:Date.now(),sessions:[]})});
  assert.match(await compact.locator('#main').innerText(),/目前沒有|No agents/);
  await compact.reload();assert.equal(await compact.evaluate(()=>PIP),true);
  check('empty compact list explains the quiet state and retains compact mode after reload');
  await page.bringToFront();
  await openSettings(page);
  await page.locator('#settingsMenu > summary').press('Escape');
  assert.equal(await page.locator('#settingsPanel').isVisible(),false);
  assert.equal(await page.locator('#settingsMenu > summary').evaluate(el=>el===document.activeElement),true);
  await openSettings(page);await page.click('h1');
  assert.equal(await page.locator('#settingsPanel').isVisible(),false);
  for (const width of [320,390,768,1280]) {
   await page.setViewportSize({width,height:800});
   for (const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    await openSettings(page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const panel=await page.locator('#settingsPanel').boundingBox();
    assert.ok(panel.x>=0 && panel.x+panel.width<=width);
    await page.locator('#settingsMenu > summary').press('Escape');
    await screenshot(page,`toolbar-${width}-${colorScheme}`);
   }
  }
  check('settings close with Escape/outside click, restore focus, and fit narrow and wide screens in both themes');
  // Live mode: full window, no titles or folders on screen, a ticker; Esc leaves.
  await page.setViewportSize({width:1200,height:800});
  await page.evaluate(()=>Hub.setLive && document.querySelector('[data-tool=live]')?.click());
  await page.waitForFunction(()=>document.body.classList.contains('live'));
  const shown=await page.evaluate(()=>({header:getComputedStyle(document.querySelector('header')).display, label:Hub.label(state.data.sessions[0]), doing:Hub.doing({status:'tool',task:'test'}), ticker:!!document.getElementById('liveTicker').textContent}));
  assert.equal(shown.header,'none');
  assert.match(shown.label,/^EMP-\d{4}$/);
  assert.equal(shown.doing,'跑測試');
  assert.ok(shown.ticker);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.body.classList.contains('live'));
  assert.doesNotMatch(await page.evaluate(()=>Hub.label(state.data.sessions[0])),/^EMP-/);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('liveTop')).display),'none','no LIVE badge off air');
  check('live mode hides names behind employee numbers, fills the window, Esc leaves');
  assert.deepEqual(errors,[]);check('no uncaught browser errors');
  console.log('TOTAL',checks.length);
 } finally {
  await browser?.close();
  watcher.stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
