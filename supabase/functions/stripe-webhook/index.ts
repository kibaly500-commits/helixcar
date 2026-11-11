import Stripe from 'npm:stripe@18.5.0';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {webhook} from '../_shared/stripe-payment.mjs';
import {jsPDF} from 'npm:jspdf@4.2.1';
import {suitePaiementTest} from '../_shared/suite-paiement-test.mjs';
Deno.serve(async req => {
  const key=Deno.env.get('STRIPE_SECRET_KEY')||'';
  if(!key.startsWith('sk_test_')) return Response.json({ok:false,message:'Mode test non configuré.'},{status:503});
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return webhook(req,{
    sb,
    afterPayment:(id:string)=>suitePaiementTest(id,{sb,jsPDF,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}}),
    stripe:new Stripe(key,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2}),
    secret:Deno.env.get('STRIPE_WEBHOOK_SECRET'),cryptoProvider:Stripe.createSubtleCryptoProvider(),
  });
});
