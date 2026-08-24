
-- 億家 App v0.9 開發測試購買 / 兌換
-- 目的：先把「隨買 → 我的商品 → 兌換 → 兌換紀錄」整條資料流程跑通
-- 正式上線前可移除這兩個 dev RPC。

create extension if not exists pgcrypto;

-- app_products 增加 SC 商品代號，作為 SC JSON 商品與已購商品之間的橋接
alter table public.app_products
  add column if not exists sc_product_code text;

create unique index if not exists uq_app_products_sc_product_code
  on public.app_products(sc_product_code)
  where sc_product_code is not null;

-- app_member_products 若舊表 product_id 是 not null，保留使用 mirror app_products 的 UUID
-- 不需要改既有 FK。

create or replace function public.dev_app_purchase_anybuy(p_product_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_product jsonb;
  v_product_uuid uuid;
  v_quantity integer;
  v_validity_days integer;
  v_member_product_id bigint;
  v_name text;
  v_price numeric(10,2);
  v_image text;
  v_note text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select phone into v_phone
  from public.app_members
  where auth_user_id = v_uid
  limit 1;

  if v_phone is null then
    raise exception 'member profile not found';
  end if;

  select elem into v_product
  from public.yijia_app_state s,
       lateral jsonb_array_elements(s.data::jsonb) elem
  where s.store_id = '001'
    and s.data_key = 'yj_app_anybuy_products'
    and coalesce((elem->>'active')::boolean, true) = true
    and (
      elem->>'code' = p_product_key
      or elem->>'id' = p_product_key
    )
  limit 1;

  if v_product is null then
    raise exception 'product not found or inactive';
  end if;

  v_name := coalesce(v_product->>'name','商品');
  v_price := coalesce(nullif(v_product->>'price','')::numeric,0);
  v_image := nullif(v_product->>'imageUrl','');
  v_note := coalesce(nullif(v_product->>'note',''), nullif(v_product->>'activityContent',''));
  v_quantity := greatest(1, coalesce(nullif(v_product->>'quantity','')::integer,1));
  v_validity_days := greatest(0, coalesce(nullif(v_product->>'validityDays','')::integer,0));

  insert into public.app_products
    (name, description, price, image_url, is_active, sc_product_code, updated_at)
  values
    (v_name, v_note, v_price, v_image, true, coalesce(v_product->>'code',p_product_key), now())
  on conflict (sc_product_code)
  do update set
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    image_url = excluded.image_url,
    is_active = true,
    updated_at = now()
  returning id into v_product_uuid;

  insert into public.app_member_products
    (auth_user_id, phone, product_id, quantity_total, quantity_remaining,
     purchased_at, expires_at, status, created_at, updated_at)
  values
    (v_uid, v_phone, v_product_uuid, v_quantity, v_quantity,
     now(),
     case when v_validity_days > 0
          then now() + make_interval(days => v_validity_days)
          else null end,
     'active', now(), now())
  returning id into v_member_product_id;

  return v_member_product_id;
end;
$$;

create or replace function public.dev_app_redeem_one(
  p_member_product_id bigint,
  p_store_code text default 'DEV'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.app_member_products%rowtype;
  v_redemption_id bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select *
  into v_row
  from public.app_member_products
  where id = p_member_product_id
    and auth_user_id = v_uid
  for update;

  if not found then
    raise exception 'member product not found';
  end if;

  if v_row.quantity_remaining <= 0 then
    raise exception 'no remaining quantity';
  end if;

  if v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'product expired';
  end if;

  update public.app_member_products
  set quantity_remaining = quantity_remaining - 1,
      status = case when quantity_remaining - 1 <= 0 then 'used' else status end,
      updated_at = now()
  where id = v_row.id;

  insert into public.app_redemptions
    (auth_user_id, member_product_id, product_id, quantity, store_code, redeemed_at, created_at)
  values
    (v_uid, v_row.id, v_row.product_id, 1, p_store_code, now(), now())
  returning id into v_redemption_id;

  return v_redemption_id;
end;
$$;

revoke all on function public.dev_app_purchase_anybuy(text) from public;
revoke all on function public.dev_app_redeem_one(bigint,text) from public;

grant execute on function public.dev_app_purchase_anybuy(text) to authenticated;
grant execute on function public.dev_app_redeem_one(bigint,text) to authenticated;

notify pgrst, 'reload schema';
