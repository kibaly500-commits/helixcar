// Contrat serveur de validation partenaire : aucun réseau réel, aucun e-mail réel.
import { traiterRequete } from '../supabase/functions/partenaire-validation/index.ts';

let pass=0,fail=0;const echecs=[];
function check(n,c){if(c){console.log('PASS - '+n);pass++;}else{console.log('FAIL - '+n);fail++;echecs.push(n);}}
const ORIGINE='https://helixcar-i89b.vercel.app';
const ID='380a3a8e-b458-4b20-a3b7-bf79e8d485f3';

function double({admin=true,statut='en_attente',authUserId=null,email='vraie-adresse@example.com'}={}){
  const partenaire={id:ID,prenom:'Test',nom:'Partenaire',email,statut,auth_user_id:authUserId,civilite:'monsieur'};
  const journal={envois:[],majs:[]};
  function requete(table,op='select',valeurs=null){
    const filtres=[];
    const api={
      select(){return api;}, update(v){return requete(table,'update',v);},
      eq(k,v){filtres.push([k,v]);return api;},
      async maybeSingle(){
        if(table==='admins') return {data:admin?{id:'admin-1'}:null,error:null};
        if(table!=='convoyeurs') return {data:null,error:null};
        const correspond=filtres.every(([k,v])=>partenaire[k]===v);
        if(!correspond)return {data:null,error:null};
        if(op==='update'){Object.assign(partenaire,valeurs);journal.majs.push({...valeurs});return {data:{id:partenaire.id},error:null};}
        return {data:{...partenaire},error:null};
      }
    };return api;
  }
  return {
    sb:{auth:{async getUser(jwt){return jwt==='jwt-admin'?{data:{user:{id:'user-admin'}},error:null}:{data:null,error:{}};}},from(n){return requete(n);}},
    partenaire,journal,
    fetch:async(url,options)=>{journal.envois.push({url,options,payload:JSON.parse(options.body)});return new Response(JSON.stringify({id:'re_123'}),{status:200,headers:{'Content-Type':'application/json'}});}
  };
}
function req(body,jwt='jwt-admin',origine=ORIGINE){return new Request('https://edge.invalid',{method:'POST',headers:{origin:origine,authorization:'Bearer '+jwt,'content-type':'application/json'},body:JSON.stringify(body)});}
const env={RESEND_API_KEY:'secret-test',HELIXCAR_URL_PUBLIQUE:'https://helixcar.fr',PARTENAIRE_LIEN_SECRET:'preuve-test-ne-pas-utiliser-en-production'};

{
  const d=double();const r=await traiterRequete(d.sb,req({action:'valider',convoyeur_id:ID}),env,d.fetch);const j=await r.json();
  check('V1 : validation et e-mail sont automatiques',r.status===200&&j.email_accepte===true&&d.partenaire.statut==='actif'&&d.journal.envois.length===1);
  check('V2 : le destinataire est relu en base',d.journal.envois[0].payload.to[0]==='vraie-adresse@example.com');
  check('V3 : le lien de recette reste sur la version validée et porte une preuve signée',
    /https:\/\/helixcar-i89b\.vercel\.app\/creer-compte-convoyeur\.html\?email=.+&dossier=.+&preuve=[0-9a-f]{64}/.test(d.journal.envois[0].payload.text));
  check('V4 : une clé d’idempotence protège le double envoi',/helixcar-partenaire\/.+\/initial/.test(d.journal.envois[0].options.headers['Idempotency-Key']));

  const lien=d.journal.envois[0].payload.text.match(/https:\/\/[^\s]+/)[0];
  const u=new URL(lien);
  const verification=await traiterRequete(d.sb,req({
    action:'verifier_lien',convoyeur_id:u.searchParams.get('dossier'),
    email:u.searchParams.get('email'),preuve:u.searchParams.get('preuve')
  },'cle-anon'),env,d.fetch);
  const resultat=await verification.json();
  check('V4b : le lien signé retrouve la candidature sans session administrateur',
    verification.status===200&&resultat.ok===true&&resultat.convoyeur_id===ID);

  const falsifie=await traiterRequete(d.sb,req({
    action:'verifier_lien',convoyeur_id:ID,email:'autre@example.com',preuve:u.searchParams.get('preuve')
  },'cle-anon'),env,d.fetch);
  check('V4c : une adresse modifiée invalide la preuve du lien',falsifie.status===403);
}
{
  const d=double({admin:false});const r=await traiterRequete(d.sb,req({action:'valider',convoyeur_id:ID}),env,d.fetch);
  check('V5 : un non-administrateur est refusé',r.status===403&&d.journal.envois.length===0&&d.partenaire.statut==='en_attente');
}
{
  const d=double({statut:'actif'});const r=await traiterRequete(d.sb,req({action:'renvoyer',convoyeur_id:ID,envoi_cle:'nouvelle-tentative'}),env,d.fetch);
  check('V6 : le renvoi de secours ne revalide pas la candidature',r.status===200&&d.journal.majs.length===0&&d.journal.envois.length===1);
}
{
  const d=double({statut:'actif',authUserId:'compte-1'});const r=await traiterRequete(d.sb,req({action:'renvoyer',convoyeur_id:ID}),env,d.fetch);const j=await r.json();
  check('V7 : aucun lien n’est envoyé si le compte existe déjà',r.status===200&&j.compte_deja_cree===true&&d.journal.envois.length===0);
}
{
  const d=double();const r=await traiterRequete(d.sb,req({action:'valider',convoyeur_id:ID},'jwt-admin','https://attaque.invalid'),env,d.fetch);
  check('V8 : une origine étrangère est refusée',r.status===403&&d.journal.envois.length===0);
}

console.log('\n=== '+pass+' PASS / '+fail+' FAIL ===');
if(echecs.length)console.log('Échecs : '+echecs.join(', '));
process.exit(fail?1:0);
