const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
const browser=await engine.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]});
try{for(const width of [320,390,430,480,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('https://**/*',r=>r.abort());
 await page.goto(pathToFileURL(path.resolve('index.html')).href);
 await page.evaluate(()=>{openModal('client');_afficherNoticeBrouillonRestaure();document.getElementById('client-notes').value='QA conservé';});
 const dims=await page.evaluate(()=>{
 const n=document.getElementById('notice-brouillon-restaure'),b=n.querySelector('.brouillon-carte-corps'),a=n.querySelector('.brouillon-carte-actions');
 const nb=n.getBoundingClientRect(),bb=b.getBoundingClientRect(),ab=a.getBoundingClientRect();
 return {height:nb.height,body:bb.height,gap:ab.top-bb.bottom,basis:getComputedStyle(b).flexBasis,overflow:n.scrollWidth>n.clientWidth+1};
 });
 if(width<=480){assert.ok(dims.body<140,JSON.stringify(dims));assert.ok(dims.height<280,JSON.stringify(dims));assert.ok(dims.gap>=0&&dims.gap<=20,JSON.stringify(dims));}else assert.equal(dims.basis,'220px');
 assert.equal(dims.overflow,false);
 await page.locator('#notice-brouillon-restaure button').first().click();
 assert.equal(await page.locator('#notice-brouillon-restaure').count(),0);
 assert.equal(await page.locator('#client-notes').inputValue(),'QA conservé');
 console.log('PASS',name,width,JSON.stringify(dims));await page.close();
}}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
