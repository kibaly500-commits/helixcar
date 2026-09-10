// Worker privé : lecture et décodage hors Edge. Aucun shell, aucun accès
// à une URL fournie par le candidat, aucun journal contenant un lien signé.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,stat,open} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
export const LIMITE=314572800;
function faute(code){const e=new Error(code);e.code=code;return e;}
function commande(programme,args,signal){return new Promise((resolve,reject)=>{
  const p=spawn(programme,args,{shell:false,stdio:['ignore','pipe','pipe'],signal});
  let stdout='',stderr='',fini=false;
  p.stdout.on('data',b=>{stdout+=b;if(stdout.length>1048576)p.kill('SIGKILL');});
  p.stderr.on('data',b=>{stderr+=b;if(stderr.length>1048576)p.kill('SIGKILL');});
  p.on('error',()=>{fini=true;reject(faute('VERIFICATION_INDISPONIBLE'));});
  p.on('close',code=>{if(fini)return;if(code!==0)reject(faute('VIDEO_ILLISIBLE'));else resolve({stdout,stderr});});
});}
export async function analyserFichier(fichier,mime,dureeMax,signal=AbortSignal.timeout(80000)){
  const taille=(await stat(fichier)).size;
  if(!Number.isSafeInteger(taille)||taille<1||taille>LIMITE)throw faute('TAILLE_REFUSEE');
  const probe=await commande('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',fichier],signal);
  let info;try{info=JSON.parse(probe.stdout);}catch{throw faute('VIDEO_ILLISIBLE');}
  const videos=(info.streams||[]).filter(s=>s.codec_type==='video');
  if(videos.length!==1||!videos[0].codec_name||!videos[0].width||!videos[0].height)throw faute('VIDEO_ILLISIBLE');
  const format=String(info.format?.format_name||'');
  // ffprobe nomme aussi Matroska « matroska,webm ». Le DocType EBML
  // distingue réellement un WebM d'un MKV renommé par le navigateur.
  let webm=false;
  if(mime==='video/webm'){
    const fd=await open(fichier,'r');const entete=Buffer.alloc(4096);
    try{const {bytesRead}=await fd.read(entete,0,entete.length,0);
      if(entete.readUInt32BE(0)===0x1a45dfa3){
        const i=entete.subarray(0,bytesRead).indexOf(Buffer.from([0x42,0x82]));
        if(i>=0&&i+3<bytesRead){const n=entete[i+2];
          webm=(n&0x80)!==0&&(n&0x7f)===4&&entete.subarray(i+3,i+7).toString()==='webm';}
      }
    }finally{await fd.close();}
  }
  const qt=String(info.format?.tags?.major_brand||'').trim()==='qt';
  if((mime==='video/webm'&&(!format.split(',').includes('webm')||!webm)) ||
     (mime==='video/quicktime'&&(!format.split(',').includes('mov')||!qt)) ||
     (mime==='video/mp4'&&(!format.split(',').includes('mp4')||qt)) ||
     !['video/webm','video/quicktime','video/mp4'].includes(mime))throw faute('FORMAT_INCOHERENT');
  const declaree=Number(info.format?.duration||0);
  if(declaree>dureeMax)throw faute('DUREE_REFUSEE');
  // Décodage jusqu'à EOF : détecte les paquets tronqués/corrompus et mesure
  // également les WebM MediaRecorder sans champ Duration dans leur en-tête.
  const decode=await commande('ffmpeg',['-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-threads','2','-i',fichier,'-map','0:v:0','-map','0:a?','-threads','2','-f','null','-','-progress','pipe:1','-nostats'],signal);
  const temps=[...decode.stdout.matchAll(/^out_time_us=(\d+)$/gm)].map(m=>Number(m[1])/1000000);
  const frames=[...decode.stdout.matchAll(/^frame=(\d+)$/gm)].map(m=>Number(m[1]));
  const duree=Math.max(declaree,...temps,0);
  if(!Number.isFinite(duree)||duree<=0||!frames.some(n=>n>0))throw faute('VIDEO_ILLISIBLE');
  if(duree>dureeMax)throw faute('DUREE_REFUSEE');
  const sha=createHash('sha256');for await(const morceau of createReadStream(fichier))sha.update(morceau);
  return{ok:true,taille_octets:taille,duree_secondes:duree,mime,codec:videos[0].codec_name,sha256:sha.digest('hex')};
}
export function urlAutorisee(url,origine,candidature){
  try{const u=new URL(url),o=new URL(origine);const chemin=decodeURIComponent(u.pathname);
    return u.origin===o.origin&&u.protocol==='https:'&&!u.username&&!u.password&&
      /^[a-f0-9-]{36}$/.test(candidature)&&
      chemin.startsWith('/storage/v1/object/sign/candidatures-videos/candidatures/'+candidature+'/verifie/')&&
      !chemin.includes('..')&&u.searchParams.has('token');
  }catch{return false;}
}
let actifs=0;
export async function traiter(req,env=process.env,fetchFn=fetch){
  const json=(code,status)=>Response.json(typeof code==='string'?{ok:false,code}:code,{status,headers:{'Cache-Control':'no-store'}});
  const secret=env.HELIXCAR_VIDEO_VALIDATION_SECRET||'';
  const recu=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(secret.length<32||Buffer.byteLength(recu)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(recu),Buffer.from(secret)))return json('UNAUTHORIZED',401);
  if(req.method!=='POST')return json('METHOD_NOT_ALLOWED',405);
  if(actifs>=2)return json('VERIFICATION_INDISPONIBLE',503);
  let corps;try{const texte=await req.text();if(texte.length>8192)throw 0;corps=JSON.parse(texte);}catch{return json('BAD_REQUEST',400);}
  if(!urlAutorisee(corps.url,env.SUPABASE_URL,corps.candidature_id)||![60,120].includes(corps.duree_max))return json('BAD_REQUEST',400);
  actifs++;let dossier;
  try{
    dossier=await mkdtemp(join(tmpdir(),'helixcar-video-'));const fichier=join(dossier,'objet');
    const signal=AbortSignal.timeout(85000);
    const rep=await fetchFn(corps.url,{redirect:'error',signal});
    if(!rep.ok||!rep.body)throw faute('VERIFICATION_INDISPONIBLE');
    if(Number(rep.headers.get('content-length'))>LIMITE)throw faute('TAILLE_REFUSEE');
    let octets=0;
    const borne=new Transform({transform(b,_e,cb){octets+=b.length;cb(octets>LIMITE?faute('TAILLE_REFUSEE'):null,b);}});
    await pipeline(Readable.fromWeb(rep.body),borne,createWriteStream(fichier,{mode:0o600,flags:'wx'}),{signal});
    return json(await analyserFichier(fichier,corps.mime,corps.duree_max,signal),200);
  }catch(e){const code=['TAILLE_REFUSEE','DUREE_REFUSEE','FORMAT_INCOHERENT','VIDEO_ILLISIBLE'].includes(e.code)?e.code:'VERIFICATION_INDISPONIBLE';return json(code,code==='VERIFICATION_INDISPONIBLE'?503:422);}
  finally{actifs--;if(dossier)await rm(dossier,{recursive:true,force:true});}
}
