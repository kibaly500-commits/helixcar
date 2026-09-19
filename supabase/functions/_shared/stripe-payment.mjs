// Paiements de recette Stripe : propriétaire réel, montant serveur, signature
// Stripe obligatoire, aucune validation depuis une URL de retour.
export const PREVIEW = 'https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app';
const ORIGINS = new Set([PREVIEW, 'https://helixcar-git-codex-helixcar-f-0253b9-kibaly500-commits-projects.vercel.app']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200, headers = {}) => Response.json(body, {status, headers:{'Cache-Control':'no-store', ...headers}});
const fail = (message, status = 409, headers = {}) => json({ok:false,message},status,headers);
export function paymentMatches(session, row) {
  return session.livemode === false && session.mode === 'payment'
    && session.payment_status === 'paid' && session.status === 'complete'
    && session.currency === 'eur' && session.amount_total === Number(row.montant_centimes)
    && session.metadata?.helixcar_checkout === row.id
    && session.metadata?.devis_id === row.devis_id
    && session.metadata?.version === String(row.version)
    && session.id === row.session_id && typeof session.payment_intent === 'string';
}
export async function checkout(req, {sb, stripe, configured}) {
  const origin=req.headers.get('origin');
  const headers={'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'};
  if(ORIGINS.has(origin)) headers['Access-Control-Allow-Origin']=origin;
  if(!ORIGINS.has(origin)) return fail('Origine non autorisée.',403,headers);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return fail('Méthode refusée.',405,headers);
  if(!configured) return fail('Le paiement de test est en cours de configuration.',503,headers);
  try {
    const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const {data:auth,error:authError}=await sb.auth.getUser(jwt);
    if(authError||!auth?.user?.id) return fail('Reconnectez-vous à votre espace client.',401,headers);
    let body; try {body=await req.json();} catch {return fail('Demande invalide.',400,headers);}
    let query=sb.from('devis').select('id,reference,client_id,prix,statut,paiement_statut,version,version_acceptee');
    if(uuid.test(body.devis_id||'')) query=query.eq('id',body.devis_id);
    else if(typeof body.token==='string' && body.token.length>=20 && body.token.length<=256) {
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      query=query.eq('acceptation_token_hash',hash);
    } else return fail('Devis inaccessible.',404,headers);
    const {data:quote,error:qe}=await query.maybeSingle();
    if(qe||!quote) return fail('Devis inaccessible.',404,headers);
    const {data:client,error:ce}=await sb.from('clients').select('id,email,prenom,nom').eq('id',quote.client_id).eq('auth_user_id',auth.user.id).maybeSingle();
    if(ce||!client) return fail('Devis inaccessible.',404,headers);
    // Le mode test reste réservé au dossier QA convenu, jamais aux clients réels.
    if(!`${client.prenom} ${client.nom}`.toUpperCase().includes('TEST-QA') || !/\+qa-final01@/i.test(client.email))
      return fail('Paiement de test réservé au parcours QA.',403,headers);
    if(quote.statut!=='accepte'||quote.version_acceptee!==quote.version) return fail('Acceptez la version actuelle du devis avant de payer.',409,headers);
    if(quote.paiement_statut==='paye') return fail('Ce devis est déjà payé.',409,headers);
    const amount=Math.round(Number(quote.prix)*100);
    if(!Number.isSafeInteger(amount)||amount<=0) return fail('Montant invalide.',409,headers);
    const candidate={devis_id:quote.id,version:quote.version,montant_centimes:amount,email:client.email,reference:quote.reference,origine:origin};
    const {error:ie}=await sb.from('stripe_checkout_sessions').upsert(candidate,{onConflict:'devis_id,version',ignoreDuplicates:true});
    if(ie) throw new Error('SESSION_INSERT');
    const {data:row,error:re}=await sb.from('stripe_checkout_sessions').select('*').eq('devis_id',quote.id).eq('version',quote.version).single();
    if(re||!row) throw new Error('SESSION_READ');
    if(Number(row.montant_centimes)!==amount) return fail('Le montant du devis a changé. Contactez HelixCar.',409,headers);
    let session;
    if(row.session_id) session=await stripe.checkout.sessions.retrieve(row.session_id);
    else {
      // Ne jamais réutiliser une clé Stripe après sa fenêtre de rétention de 24 h.
      // En cas de panne prolongée avant sauvegarde, intervention requise, sans
      // créer une seconde session potentiellement déjà payée.
      if(Date.now()-Date.parse(row.created_at)>23*3600000) return fail('Session à réinitialiser par HelixCar.',409,headers);
      const back=row.origine+'/devis.html?id='+encodeURIComponent(row.devis_id);
      session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],locale:'fr',
        client_reference_id:row.devis_id,customer_email:row.email,
        success_url:back+'&paiement=retour',cancel_url:back+'&paiement=annule',
        metadata:{helixcar_checkout:row.id,devis_id:row.devis_id,version:String(row.version)},
        line_items:[{quantity:1,price_data:{currency:'eur',unit_amount:Number(row.montant_centimes),product_data:{name:'TEST — Devis HelixCar '+row.reference}}}],
      },{idempotencyKey:'helixcar-checkout-test/'+row.id});
      if(session.livemode!==false) throw new Error('LIVE_MODE');
      const {error:se}=await sb.from('stripe_checkout_sessions').update({session_id:session.id}).eq('id',row.id);
      if(se) throw new Error('SESSION_SAVE');
    }
    if(session.livemode!==false) throw new Error('LIVE_MODE');
    if(session.status==='complete') return fail('Paiement transmis à Stripe. La confirmation serveur est en cours.',409,headers);
    if(session.status!=='open'||!session.url) return fail('Cette session de paiement a expiré. Contactez HelixCar.',409,headers);
    if(new URL(session.url).origin!=='https://checkout.stripe.com') throw new Error('CHECKOUT_URL');
    return json({ok:true,url:session.url},200,headers);
  } catch {return fail('Paiement indisponible pour le moment. Réessayez dans quelques instants.',503,headers);}
}
export async function webhook(req,{sb,stripe,secret,cryptoProvider}) {
  if(req.method!=='POST') return fail('Méthode refusée.',405);
  if(!secret) return fail('Webhook non configuré.',503);
  let event;
  try {event=await stripe.webhooks.constructEventAsync(await req.text(),req.headers.get('stripe-signature')||'',secret,300,cryptoProvider);}
  catch {return fail('Signature invalide.',400);}
  if(event.livemode!==false) return fail('Mode réel refusé.',400);
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return json({ok:true,ignored:true});
  const announced=event.data?.object;
  if(!announced?.metadata?.helixcar_checkout) return json({ok:true,ignored:true});
  try {
    const {data:row,error}=await sb.from('stripe_checkout_sessions').select('*').eq('id',announced.metadata.helixcar_checkout).maybeSingle();
    if(error||!row||!row.session_id) return fail('Session en attente de rapprochement.',503);
    if(row.session_id!==announced.id) return fail('Session incohérente.',400);
    const session=await stripe.checkout.sessions.retrieve(row.session_id);
    if(session.payment_status!=='paid') return json({ok:true,pending:true});
    if(!paymentMatches(session,row)) return fail('Paiement incohérent.',400);
    const {data:result,error:rpcError}=await sb.rpc('confirmer_stripe_checkout_test',{
      p_session_id:session.id,p_evenement_id:event.id,p_montant_centimes:session.amount_total,
      p_devise:session.currency,p_payment_intent:session.payment_intent});
    if(rpcError||!result?.ok) return fail('Confirmation à retraiter.',503);
    return json({ok:true});
  } catch {return fail('Confirmation à retraiter.',503);}
}
