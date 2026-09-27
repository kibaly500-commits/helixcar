const { chromium, webkit }=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=process.cwd();
const server=http.createServer((req,res)=>{
 const f=path.join(root,decodeURIComponent(req.url.split('?')[0]));
 if(!f.startsWith(root)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 const size=fs.statSync(f).size;
 const mime=f.endsWith('.mp4')?'video/mp4':f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream';
 if(req.headers.range){const [a,b]=req.headers.range.replace('bytes=','').split('-');const start=+a,end=b?+b:size-1;res.writeHead(206,{'Content-Type':mime,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(f,{start,end}).pipe(res);}
 else{res.writeHead(200,{'Content-Type':mime,'Content-Length':size});fs.createReadStream(f).pipe(res);}
});
(async()=>{
 await new Promise(r=>server.listen(8765,'127.0.0.1',r));
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch(name==='chromium'?{channel:'chrome',args:['--no-sandbox']}:{});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765/')?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8765/index.html');
 assert(await page.evaluate(()=>window.scrollY===0));
 await page.locator('#services-video').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const v=document.getElementById('services-video');return v.currentTime>.5&&!v.paused});
 assert(await page.locator('#services-video').evaluate(v=>v.muted&&v.videoWidth===1280));
 await page.locator('#services-video-sound').click();
 assert(await page.locator('#services-video').evaluate(v=>!v.muted&&!v.paused));
 await page.locator('#services-video-play').click();
 await page.waitForFunction(()=>document.getElementById('services-video').paused);
 await page.locator('#services-video-play').click();
 await page.waitForFunction(()=>!document.getElementById('services-video').paused);
 await page.locator('#services-video-sound').click();
 for(const width of [320,390,768,1280]){
 await page.setViewportSize({width,height:900});
 await page.locator('#services-video').scrollIntoViewIfNeeded();
 const v=await page.locator('#services-video').boundingBox();
 if(width<=900){assert(Math.abs(v.width/v.height-1280/536)<.02);
 const gap=await page.evaluate(()=>document.querySelector('.services-showcase').getBoundingClientRect().top-document.querySelector('.services-intro .section-sub').getBoundingClientRect().bottom);
 assert(gap<=25, 'mobile gap '+gap);
 }else{assert(v.height<=430&&v.height>=260);assert(await page.locator('.services-showcase-caption').isVisible());}
 await page.locator('.services-showcase').screenshot({path:`/tmp/video-${name}-${width}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.reload();
 await page.locator('#services-video').scrollIntoViewIfNeeded();
 assert(await page.locator('#services-video').evaluate(v=>v.paused&&v.muted));
 await page.locator('#services-video-play').click();
 await page.waitForFunction(()=>!document.getElementById('services-video').paused);
 console.log(name+': lecture, son, pause, cadrage, espacement et ouverture sans saut OK');
 await browser.close();
 }server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
