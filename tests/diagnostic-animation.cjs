const L=require('./lib');
(async()=>{
 const browser=await L.launch();let failures=0;
 try {for(let repeat=0;repeat<20;repeat++){
  const page=await L.newPage(browser);await page.setViewportSize({width:390,height:1000});
  const errors=await page.evaluate(()=>{
   const errors=[];
   for(const p of [0,.1,.249,.5,.749,.99,1]){
    _hcRendreProgressionVitrine(p);
    document.querySelectorAll('.hero2-route,.loyalty-track').forEach(root=>{
     if(!root.offsetWidth)return;
     const el=root.querySelector('.hc-sync-line'),line=el.getBoundingClientRect(),vertical=el.dataset.direction==='vertical';
     root.querySelectorAll('.hero2-route-dot,.node-circle').forEach((n,i)=>{
      const r=n.getBoundingClientRect(),center=vertical?r.top+r.height/2:r.left+r.width/2,end=vertical?line.top+line.height*p:line.left+line.width*p;
      const expected=center<=end+.02,actual=n.classList.contains('hc-reached');
      if(actual!==expected)errors.push({p,i,root:root.className,center,end,delta:center-end,actual,expected,line:line.toJSON(),node:r.toJSON(),rootRect:root.getBoundingClientRect().toJSON(),transform:getComputedStyle(root).transform,parentTransform:getComputedStyle(root.parentElement).transform});
     });
    });
   }return errors;
  });
  failures+=errors.length;if(errors.length)console.log('GEOMETRY',repeat,JSON.stringify(errors));
  await page.close();
 }console.log('DIAGNOSTIC',failures,'mismatches in 20 loads');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
