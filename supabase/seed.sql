-- Reference rows the apps expect to exist. Safe to run again.

insert into public.plans (id, name, name_bn, description, description_bn, price_monthly, price_yearly, features, active, is_default, icon, sort_order)
values
  ('free', 'Free', 'ফ্রি', 'Read the laws and a few judgments.', 'আইন আর কয়েকটি রায় পড়ুন।', 0, 0,
   '[{"en":"All laws","bn":"সব আইন"},{"en":"A few judgments","bn":"কয়েকটি রায়"},{"en":"5 AI questions a month","bn":"মাসে ৫টি এআই প্রশ্ন"},{"en":"5 saved items","bn":"৫টি সংরক্ষিত আইটেম"}]',
   true, true, 'gift', 0),
  ('researcher', 'Researcher', 'রিসার্চার', 'Every judgment, advanced search and PDF downloads.', 'সব রায়, অ্যাডভান্সড সার্চ আর পিডিএফ ডাউনলোড।', 100, 960,
   '[{"en":"All laws and judgments","bn":"সব আইন ও রায়"},{"en":"Advanced search","bn":"অ্যাডভান্সড সার্চ"},{"en":"30 AI questions a month","bn":"মাসে ৩০টি এআই প্রশ্ন"},{"en":"50 saved items","bn":"৫০টি সংরক্ষিত আইটেম"},{"en":"PDF downloads","bn":"পিডিএফ ডাউনলোড"},{"en":"Related cases and citations","bn":"সম্পর্কিত মামলা ও সাইটেশন"}]',
   true, false, 'cap', 1),
  ('professional', 'Professional', 'প্রফেশনাল', 'Unlimited AI, case analysis and priority support.', 'সীমাহীন এআই, মামলা বিশ্লেষণ আর অগ্রাধিকার সাপোর্ট।', 300, 2880,
   '[{"en":"Everything in Researcher","bn":"রিসার্চারের সবকিছু"},{"en":"Unlimited AI questions","bn":"সীমাহীন এআই প্রশ্ন"},{"en":"Unlimited saved items","bn":"সীমাহীন সংরক্ষিত আইটেম"},{"en":"Case analysis and comparison","bn":"মামলা বিশ্লেষণ ও তুলনা"},{"en":"Export citations","bn":"সাইটেশন এক্সপোর্ট"},{"en":"Priority support","bn":"অগ্রাধিকার সাপোর্ট"}]',
   true, false, 'crown', 2)
on conflict (id) do update set
  name = excluded.name, name_bn = excluded.name_bn, description = excluded.description, description_bn = excluded.description_bn,
  price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly, features = excluded.features, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.wallet_accounts (method, number, type, name, enabled)
values ('bkash', '01700 000 000', 'personal', 'Lawsboi', true), ('nagad', '01800 000 000', 'personal', 'Lawsboi', true)
on conflict (method) do nothing;

insert into public.site_settings (key, value)
values
  ('assistant_limits', '{"free": 5, "researcher": 30, "professional": null}'),
  ('contact', '{"email": "support@lawsboi.com", "phone": "", "whatsapp": "", "replyTime": {"en": "We usually reply within 24 hours.", "bn": "সাধারণত ২৪ ঘণ্টার মধ্যে উত্তর দিই।"}, "hours": {"en": "", "bn": ""}, "office": {"en": "", "bn": ""}, "officeNote": {"en": "", "bn": ""}}')
on conflict (key) do nothing;

insert into public.site_pages (slug, path, fixed) values ('privacy', '/privacy', false), ('disclaimer', '/disclaimer', false), ('about', '/about', true)
on conflict (slug) do nothing;
