import {handle} from '../services/planning/trafic.mjs';
export const config={maxDuration:120};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Méthode non autorisée'});
 try{
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
  if(Buffer.byteLength(raw)>2048)return res.status(413).json({error:'Requête trop volumineuse'});
  const r=await handle(JSON.parse(raw),req.headers);return res.status(r.status).json(r.body);
 }catch{return res.status(503).json({error:'Calcul temporairement indisponible. Réessayez.'});}
}
