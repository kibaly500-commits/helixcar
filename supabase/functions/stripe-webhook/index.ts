import Stripe from 'npm:stripe@18.5.0';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {webhook} from '../_shared/stripe-payment.mjs';
Deno.serve(async req => {
  const key=Deno.env.get('STRIPE_SECRET_KEY')||'';
  if(!key.startsWith('sk_test_')) return Response.json({ok:false,message:'Mode test non configuré.'},{status:503});
  return webhook(req,{
    sb:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    stripe:new Stripe(key,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2}),
    secret:Deno.env.get('STRIPE_WEBHOOK_SECRET'),cryptoProvider:Stripe.createSubtleCryptoProvider(),
  });
});
