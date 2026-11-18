// Fonction Vercel privée par jeton à usage unique. Le fichier vidéo ne passe
// jamais par la requête du navigateur : le worker le lit via une URL Supabase
// signée de trois minutes, puis supprime systématiquement sa copie temporaire.
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {traiter} from '../services/video-validation/valider.mjs';

process.env.FFMPEG_PATH=ffmpegPath;
process.env.FFPROBE_PATH=ffprobeStatic.path;

export const config={maxDuration:300};

export default async function handler(req,res){
  try{
    if(req.method!=='POST'){res.status(405).setHeader('Cache-Control','no-store').json({ok:false,code:'METHOD_NOT_ALLOWED'});return;}
    const texte=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
    if(Buffer.byteLength(texte)>8192){res.status(413).setHeader('Cache-Control','no-store').json({ok:false,code:'BAD_REQUEST'});return;}
    const headers=new Headers();
    for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
    const reponse=await traiter(new Request('https://worker.invalid/api/video-validation',{method:'POST',headers,body:texte}));
    res.status(reponse.status);
    for(const [k,v] of reponse.headers)res.setHeader(k,v);
    res.send(await reponse.text());
  }catch{
    res.status(503).setHeader('Cache-Control','no-store').json({ok:false,code:'VERIFICATION_INDISPONIBLE'});
  }
}
