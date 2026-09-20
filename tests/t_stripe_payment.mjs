import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkout,webhook,PREVIEW} from '../supabase/functions/_shared/stripe-payment.mjs';
const ID='11111111-1111-4111-8111-111111111111';
function fixture(){
  const q={id:ID,reference:'DEV-QA',client_id:'client',prix:1200,statut:'accepte',version:1,version_acceptee:1,paiement_statut:'en_attente'};
  const c={id:'client',auth_user_id:'user',prenom:'TEST-QA',nom:'PARCOURS-FINAL-01',email:'helixcarpro+qa-final01@gmail.com'};
  const user={id:'user',email:c.email};
  let row=null,session=null,created=0,rpcs=0;const idempotent=new Map();
  const sb={auth:{getUser:async token=>token==='valid'?{data:{user}}:{error:true}},from(table){
    let filters=[],op='read',payload;
    const builder={select(){return builder;},eq(k,v){filters.push([k,v]);return builder;},
      upsert(v){op='upsert';payload=v;return builder;},update(v){op='update';payload=v;return builder;},
      async then(resolve,reject){try{return resolve(await execute());}catch(e){return reject(e);}},
      maybeSingle:execute,single:execute};
    async function execute(){
      if(op==='upsert'){row ||= {id:'checkout-1',created_at:new Date().toISOString(),session_id:null,...payload};return {error:null};}
      const value=table==='devis'?q:table==='clients'?c:row;
      if(!value||!filters.every(([k,v])=>value[k]===v))return {data:null,error:null};
      if(op==='update')Object.assign(value,payload);
      return {data:{...value},error:null};
    }
    return builder;
  },async rpc(name,args){rpcs++;assert.equal(name,'confirmer_stripe_checkout_test');assert.equal(args.p_montant_centimes,120000);q.paiement_statut='paye';return {data:{ok:true}};}};
  const stripe={checkout:{sessions:{async create(params,opts){
    if(idempotent.has(opts.idempotencyKey))return idempotent.get(opts.idempotencyKey);
    created++;assert.equal(params.line_items[0].price_data.unit_amount,120000);
    session={id:'cs_test_1',livemode:false,status:'open',payment_status:'unpaid',mode:'payment',currency:'eur',amount_total:120000,metadata:params.metadata,url:'https://checkout.stripe.com/c/pay/test',payment_intent:'pi_test'};
    idempotent.set(opts.idempotencyKey,session);return session;
  },async retrieve(){return session;}}},webhooks:{async constructEventAsync(body,sig){if(sig!=='valid')throw Error('invalid');return JSON.parse(body);}}};
  return {sb,stripe,configured:true,secret:'test-only',q,c,user,get row(){return row;},get session(){return session;},get created(){return created;},get rpcs(){return rpcs;}};
}
function req(body={devis_id:ID},origin=PREVIEW,jwt='valid') {return new Request('https://example.invalid',{method:'POST',headers:{origin,authorization:'Bearer '+jwt},body:JSON.stringify(body)});}
async function pay(f){const r=await checkout(req(),f);assert.equal(r.status,200);f.session.status='complete';f.session.payment_status='paid';}
function event(f,signature='valid',changes={}) {return new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':signature},body:JSON.stringify({id:'evt_test',livemode:false,type:'checkout.session.completed',data:{object:{...f.session}},...changes})});}
test('origine, session absente, tiers, client réel, devis non accepté, obsolète, payé refusés',async()=>{
  const a=fixture();assert.equal((await checkout(req({},'https://evil.invalid'),a)).status,403);
  assert.equal((await checkout(req(undefined,PREVIEW,'invalid'),a)).status,401);
  for(const mutate of [f=>f.c.auth_user_id='other',f=>f.c.email='client@example.invalid',f=>f.user.email='intrus+qa-final01@example.invalid',f=>f.q.statut='envoye',f=>f.q.version_acceptee=2,f=>f.q.paiement_statut='paye']){
    const f=fixture();mutate(f);assert.ok((await checkout(req(),f)).status>=400);assert.equal(f.created,0);
  }
});
test('compte QA : prénom et nom libres, y compris uhu uuhu',async()=>{
  const f=fixture();f.c.prenom='uhu';f.c.nom='uuhu';
  const r=await checkout(req(),f);assert.equal(r.status,200);assert.equal(f.created,1);assert.equal(f.rpcs,0);
});
test('suffixe QA imité dans le compte et le dossier refusé',async()=>{
  const f=fixture();f.user.email=f.c.email='intrus+qa-final01@example.invalid';
  assert.equal((await checkout(req(),f)).status,403);assert.equal(f.created,0);
});
test('webhook non configuré empêche Checkout',async()=>{const f=fixture();f.configured=false;assert.equal((await checkout(req(),f)).status,503);assert.equal(f.created,0);});
test('double clic concurrent : une session, montant exclusivement serveur',async()=>{
  const f=fixture();const rs=await Promise.all([checkout(req({devis_id:ID,amount:1}),f),checkout(req(),f)]);
  for(const r of rs)assert.equal(r.status,200);assert.equal(f.created,1);assert.equal(f.rpcs,0);
});
test('session payée non encore rapprochée ne permet pas un autre paiement',async()=>{const f=fixture();await pay(f);assert.equal((await checkout(req(),f)).status,409);assert.equal(f.created,1);assert.equal(f.rpcs,0);});
test('session expirée et réservation trop ancienne refusées sans nouveau paiement',async()=>{
  const f=fixture();await checkout(req(),f);f.session.status='expired';assert.equal((await checkout(req(),f)).status,409);assert.equal(f.created,1);
  f.row.session_id=null;f.row.created_at='2020-01-01';assert.equal((await checkout(req(),f)).status,409);assert.equal(f.created,1);
});
test('signature invalide, mode réel, montant, devise, métadonnées invalides ne confirment rien',async()=>{
  const f=fixture();await pay(f);assert.equal((await webhook(event(f,'invalid'),f)).status,400);
  assert.equal((await webhook(event(f,'valid',{livemode:true}),f)).status,400);assert.equal(f.rpcs,0);
  for(const mutate of [f=>f.session.livemode=true,f=>f.session.amount_total=1,f=>f.session.currency='usd',f=>f.session.metadata.version='2',f=>f.session.metadata.devis_id='other']){
    const g=fixture();await pay(g);mutate(g);assert.equal((await webhook(event(g),g)).status,400);assert.equal(g.rpcs,0);
  }
});
test('paiement non payé reste en attente',async()=>{const f=fixture();await checkout(req(),f);assert.equal((await webhook(event(f),f)).status,200);assert.equal(f.rpcs,0);assert.equal(f.q.paiement_statut,'en_attente');});
test('confirmation signée et relue chez Stripe passe par la RPC transactionnelle',async()=>{const f=fixture();await pay(f);assert.equal((await webhook(event(f),f)).status,200);assert.equal(f.rpcs,1);assert.equal(f.q.paiement_statut,'paye');});
test('échec base renvoyé à Stripe pour nouvelle livraison',async()=>{const f=fixture();await pay(f);f.sb.rpc=async()=>({error:true});assert.equal((await webhook(event(f),f)).status,503);});
