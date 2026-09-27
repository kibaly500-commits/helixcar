const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]});
 try{for(const width of [320,390,430,480,720]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('https://**/*',r=>r.abort());
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.evaluate(()=>openModal('client'));
  await page.waitForTimeout(400);
  const d=await page.evaluate(()=>{
   const button=document.querySelector('#modal-client-form > .modal-close').getBoundingClientRect();
   const title=document.getElementById('client-modal-titre'),tb=title.getBoundingClientRect();
   const sub=document.getElementById('client-modal-sous-titre').getBoundingClientRect();
   const form=document.getElementById('modal-client-form').getBoundingClientRect();
   const range=document.createRange();range.selectNodeContents(title);
   const overlap=Array.from(range.getClientRects()).some(r=>r.left<button.right&&r.right>button.left&&r.top<button.bottom&&r.bottom>button.top);
   return {width:button.width,height:button.height,top:button.top-tb.top,right:form.right-button.right,subtitleGap:sub.top-button.bottom,overlap};
  });
  assert.ok(d.width>=44&&d.height>=44,JSON.stringify(d));assert.ok(Math.abs(d.top)<1&&Math.abs(d.right)<1,JSON.stringify(d));assert.ok(d.subtitleGap>=0,JSON.stringify(d));assert.equal(d.overlap,false);
  await page.locator('#modal-client-form > .modal-close').click();
  assert.equal(await page.locator('#modal-client').evaluate(e=>e.classList.contains('open')),false);
  console.log('PASS',name,width,JSON.stringify(d));await page.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
