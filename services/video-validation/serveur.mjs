import {createServer} from 'node:http';
import {traiter} from './valider.mjs';
const serveur=createServer(async(req,res)=>{
  try{
    if(req.url!=='/verifier'){res.writeHead(404);res.end();return;}
    let taille=0;const morceaux=[];
    for await(const b of req){taille+=b.length;if(taille>8192){res.writeHead(413);res.end();return;}morceaux.push(b);}
    const reponse=await traiter(new Request('https://worker.invalid/verifier',{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(morceaux)}));
    res.writeHead(reponse.status,Object.fromEntries(reponse.headers));res.end(await reponse.text());
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"ok":false,"code":"VERIFICATION_INDISPONIBLE"}');}
});
serveur.requestTimeout=100000;serveur.headersTimeout=10000;serveur.listen(Number(process.env.PORT||8080),'0.0.0.0');
