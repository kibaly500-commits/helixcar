import Stripe from 'npm:stripe@18.5.0';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checkout} from '../_shared/stripe-payment.mjs';
Deno.serve(async req => {
  const key=Deno.env.get('STRIPE_SECRET_KEY')||'';
  const configured=key.startsWith('sk_test_') && !!Deno.env.get('STRIPE_WEBHOOK_SECRET');
  return checkout(req,{
    sb:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    stripe:configured ? new Stripe(key,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2}) : null,
    configured,
  });
});
