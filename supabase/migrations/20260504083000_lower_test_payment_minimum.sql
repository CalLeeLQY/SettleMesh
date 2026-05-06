update public.topup_packages
   set price_usd = 0.50,
       credit_amount = 50,
       bonus_credit = 0,
       label = '50 Credits'
 where slug = 'credits_100';
