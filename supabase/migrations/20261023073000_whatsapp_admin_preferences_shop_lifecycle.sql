-- Keep the automatically-created WhatsApp preference row subordinate to the
-- shop membership lifecycle. An otherwise-unused shop must remain deletable;
-- all user-authored WhatsApp records continue to use restrictive foreign keys.

alter table public.whatsapp_admin_preferences
  drop constraint whatsapp_admin_preferences_business_id_shop_id_fkey;

alter table public.whatsapp_admin_preferences
  add constraint whatsapp_admin_preferences_business_id_shop_id_fkey
  foreign key (business_id, shop_id)
  references public.business_shops(business_id, shop_id)
  on delete cascade;
