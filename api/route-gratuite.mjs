import {handleFreeRoute} from '../services/planning/route-gratuite.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Méthode non autorisée'});
 if((Number(req.headers['content-length'])||0)>4096)return res.status(413).json({error:'Demande trop volumineuse'});
 const r=await handleFreeRoute(req.body||{},req.headers);
 return res.status(r.status).json(r.body);
}
