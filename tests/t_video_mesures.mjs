// Décodage réel de médias locaux identifiables. Ni Supabase ni e-mail.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {analyserFichier,traiter,urlAutorisee} from '../services/video-validation/valider.mjs';
let pass=0,fail=0;async function cas(n,f){try{await f();console.log('PASS - '+n);pass++;}catch(e){console.log('FAIL - '+n+': '+e.message);fail++;}}
const dossier=await mkdtemp(join(tmpdir(),'TEST-QA-CLAUDE-HELIXCAR-video-'));
function generer(nom,args){const p=join(dossier,nom);const r=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=gray:s=160x120:r=10',...args,'-y',p],{timeout:90000});assert.equal(r.status,0,r.stderr?.toString());return p;}
try{
 const mp4=generer('TEST-QA-CLAUDE-HELIXCAR.mp4',['-t','1','-c:v','libx264','-pix_fmt','yuv420p']);
 const mov=generer('TEST-QA-CLAUDE-HELIXCAR.mov',['-t','1','-c:v','libx264','-pix_fmt','yuv420p']);
 await cas('MP4 : mesure réelle et empreinte SHA-256',async()=>{const r=await analyserFichier(mp4,'video/mp4',120);assert.equal(r.duree_secondes,1);assert.equal(r.codec,'h264');assert.match(r.sha256,/^[a-f0-9]{64}$/);});
 await cas('MOV : conteneur QuickTime mesuré',async()=>{const r=await analyserFichier(mov,'video/quicktime',120);assert.equal(r.duree_secondes,1);});
 await cas('WebM : 30 secondes décodées',async()=>{const r=await analyserFichier('tests/medias/video_30s.webm','video/webm',60);assert.equal(r.duree_secondes,30);});
 await cas('Une vidéo de 150 secondes est refusée, indépendamment du navigateur',async()=>{await assert.rejects(analyserFichier('tests/medias/video_150s.webm','video/webm',120),e=>e.code==='DUREE_REFUSEE');});
 await cas('Le format MOV ne passe pas pour un MP4',async()=>{await assert.rejects(analyserFichier(mov,'video/mp4',120),e=>e.code==='FORMAT_INCOHERENT');});
 await cas('Un MKV renommé WebM est refusé',async()=>{const p=generer('TEST-QA-CLAUDE-HELIXCAR.mkv',['-t','1','-c:v','libx264']);await assert.rejects(analyserFichier(p,'video/webm',120),e=>e.code==='FORMAT_INCOHERENT');});
 await cas('Un conteneur tronqué est refusé',async()=>{const p=join(dossier,'TEST-QA-CLAUDE-HELIXCAR-tronque.mp4');await writeFile(p,(await readFile(mp4)).subarray(0,800));await assert.rejects(analyserFichier(p,'video/mp4',120));});
 await cas('Fichier vide refusé',async()=>{const p=join(dossier,'TEST-QA-CLAUDE-HELIXCAR-vide.mp4');await writeFile(p,'');await assert.rejects(analyserFichier(p,'video/mp4',120),e=>e.code==='TAILLE_REFUSEE');});
 for(const duree of ['119.9','120','120.1'])await cas('Borne réelle '+duree+' secondes',async()=>{const p=generer('TEST-QA-CLAUDE-HELIXCAR-'+duree+'.mp4',['-t',duree,'-c:v','libx264','-pix_fmt','yuv420p']);if(Number(duree)>120)await assert.rejects(analyserFichier(p,'video/mp4',120),e=>e.code==='DUREE_REFUSEE');else assert.equal((await analyserFichier(p,'video/mp4',120)).duree_secondes,Number(duree));});
 const id='11111111-1111-4111-8111-111111111111';const url='https://projet.supabase.co/storage/v1/object/sign/candidatures-videos/candidatures/'+id+'/verifie/objet.mov?token=TEST-QA-CLAUDE-HELIXCAR';
 await cas('Worker : refus URL hostile, autre dossier et redirection',async()=>{assert.ok(urlAutorisee(url,'https://projet.supabase.co',id));assert.ok(!urlAutorisee(url.replace('projet.supabase.co','pirate.invalid'),'https://projet.supabase.co',id));assert.ok(!urlAutorisee(url,'https://projet.supabase.co','22222222-2222-4222-8222-222222222222'));});
 await cas('Worker : identité serveur obligatoire avant toute lecture',async()=>{let n=0;const r=await traiter(new Request('https://worker.invalid/verifier',{method:'POST',body:'{}'}),{},async()=>{n++;});assert.equal(r.status,401);assert.equal(n,0);});
 await cas('Worker : transport streaming puis mesures réelles',async()=>{
   const secret='TEST-QA-CLAUDE-HELIXCAR-secret-worker';
   const req=new Request('https://worker.invalid/verifier',{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({url,candidature_id:id,mime:'video/quicktime',duree_max:120})});
   const r=await traiter(req,{SUPABASE_URL:'https://projet.supabase.co',HELIXCAR_VIDEO_VALIDATION_SECRET:secret},async(_url,options)=>{assert.equal(options.redirect,'error');return new Response(await readFile(mov));});assert.equal(r.status,200);assert.equal((await r.json()).duree_secondes,1);
 });
 await cas('Worker : jeton unique échangé côté serveur avant lecture privée',async()=>{
   const token='A'.repeat(43),claim='https://projet.supabase.co/functions/v1/candidature-video';let appels=0;
   const req=new Request('https://worker.invalid/api/video-validation',{method:'POST',body:JSON.stringify({claim_url:claim,token,candidature_id:id})});
   const r=await traiter(req,{SUPABASE_URL:'https://projet.supabase.co'},async(u,options)=>{
     appels++;
     if(appels===1){assert.equal(u,claim);assert.equal(options.headers.Authorization,'HelixCar-Video '+token);return Response.json({ok:true,url,mime:'video/quicktime',duree_max:120});}
     assert.equal(u,url);assert.equal(options.redirect,'error');return new Response(await readFile(mov));
   });
   assert.equal(r.status,200);assert.equal((await r.json()).duree_secondes,1);assert.equal(appels,2);
 });
 if(process.env.HC_VIDEO_GRANDE==='1')await cas('MOV réel comparable : 119 secondes et environ 214,6 Mo',async()=>{
   const p=join(dossier,'TEST-QA-CLAUDE-HELIXCAR-119s.mov');
   const cmd=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=gray:s=640x328:r=3','-t','119','-c:v','rawvideo','-pix_fmt','rgb24','-threads','1','-y',p],{timeout:90000});assert.equal(cmd.status,0,cmd.stderr?.toString());
   const r=await analyserFichier(p,'video/quicktime',120);assert.equal(r.duree_secondes,119);assert.ok(r.taille_octets>210*1024*1024&&r.taille_octets<220*1024*1024);console.log('MESURE - '+JSON.stringify(r));
 });
 if(process.env.HC_VIDEO_GRANDE==='1')for(const taille of [314572799,314572800,314572801])await cas('Borne exacte '+taille+' octets, MOV valide avec atome free',async()=>{
   // L'atome libre appartient au format MOV : fixture de taille, pas une
   // preuve de performance d'encodage à ce débit ni d'upload Supabase.
   const p=join(dossier,'TEST-QA-CLAUDE-HELIXCAR-borne-'+taille+'.mov');const original=await readFile(mov);
   const libre=Buffer.alloc(8);libre.writeUInt32BE(taille-original.length);libre.write('free',4);
   await writeFile(p,Buffer.concat([original,libre]));const fd=await open(p,'r+');try{await fd.truncate(taille);}finally{await fd.close();}
   if(taille>314572800)await assert.rejects(analyserFichier(p,'video/quicktime',120),e=>e.code==='TAILLE_REFUSEE');
   else assert.equal((await analyserFichier(p,'video/quicktime',120)).taille_octets,taille);
 });
}finally{await rm(dossier,{recursive:true,force:true});}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;
