
-- 億家 App v0.9.3 — App / TM 共用 yijia_app_state 正式串接
-- 不再以 app_checkout_orders 作為店舖結帳主要資料來源。
-- App 建立：HQ / yj_app_anybuy_orders
-- TM 付款後建立：HQ / yj_app_member_products

create extension if not exists pgcrypto;

-- 建立店舖結帳訂單：直接寫 HQ / yj_app_anybuy_orders
create or replace function public.app_create_store_checkout_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_name text;
  v_member_no text;
  v_order_id text;
  v_payment_code text;
  v_uuid text;
  v_deadline timestamptz := now() + interval '24 hours';
  v_now timestamptz := now();
  v_item jsonb;
  v_product jsonb;
  v_product_key text;
  v_cart_qty integer;
  v_bundle_qty integer;
  v_total_qty integer;
  v_price numeric := 0;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_new_order jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items)=0 then
    raise exception 'cart is empty';
  end if;

  select phone, coalesce(name,'')
    into v_phone, v_name
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then
    raise exception 'member profile not found';
  end if;

  v_member_no := 'YJ' || v_phone;
  v_uuid := gen_random_uuid()::text;
  v_order_id := 'AO' || to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
                || lpad((floor(random()*1000))::int::text,3,'0');
  v_payment_code := 'YS' || to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
                    || lpad((floor(random()*1000))::int::text,3,'0');

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_key := nullif(v_item->>'productKey','');
    v_cart_qty := greatest(1,coalesce(nullif(v_item->>'cartQty','')::integer,1));

    select elem into v_product
    from public.yijia_app_state s,
         lateral jsonb_array_elements(s.data::jsonb) elem
    where s.store_id='001'
      and s.data_key='yj_app_anybuy_products'
      and coalesce((elem->>'active')::boolean,true)=true
      and (elem->>'code'=v_product_key or elem->>'id'=v_product_key)
    limit 1;

    if v_product is null then
      raise exception 'product not found or inactive: %',v_product_key;
    end if;

    v_price := coalesce(nullif(v_product->>'price','')::numeric,0);
    v_bundle_qty := greatest(1,coalesce(nullif(v_product->>'quantity','')::integer,1));
    v_total_qty := v_bundle_qty * v_cart_qty;
    v_total := v_total + (v_price * v_cart_qty);

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'productId',coalesce(v_product->>'id',v_product->>'code'),
        'code',coalesce(v_product->>'code',v_product_key),
        'name',coalesce(v_product->>'name','商品'),
        'category',coalesce(v_product->>'category','隨買'),
        'price',v_price,
        'quantity',v_total_qty,
        'cartQuantity',v_cart_qty,
        'validityDays',greatest(0,coalesce(nullif(v_product->>'validityDays','')::integer,0)),
        'activityStartDate',coalesce(v_product->>'activityStartDate',''),
        'activityEndDate',coalesce(v_product->>'activityEndDate',''),
        'activityContent',coalesce(v_product->>'activityContent','')
      )
    );
  end loop;

  v_new_order := jsonb_build_object(
    'id',v_uuid,
    'orderId',v_order_id,
    'paymentCode',v_payment_code,
    'memberId',v_uid::text,
    'memberNo',v_member_no,
    'memberPhone',v_phone,
    'memberName',v_name,
    'paymentMethod','店舖結帳',
    'status','待付款',
    'paymentStatus','pending',
    'total',v_total,
    'paymentDeadline',
      to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
    'items',v_items,
    'createdAt',
      to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
    'updatedAt',
      to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'
  );

  -- 同一 key 以 row lock 保護 JSON array 更新
  select coalesce(data::jsonb,'[]'::jsonb)
    into v_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1
  for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_anybuy_orders',jsonb_build_array(v_new_order),now());
  else
    update public.yijia_app_state
    set data=(v_orders || jsonb_build_array(v_new_order)),
        updated_at=now()
    where store_id='HQ' and data_key='yj_app_anybuy_orders';
  end if;

  return v_new_order;
end;
$$;

-- 只允許會員讀自己的指定訂單，不直接暴露 HQ 整個 JSON array
create or replace function public.app_get_anybuy_order(p_payment_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_member_no text;
  v_orders jsonb;
  v_order jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select phone into v_phone
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  v_member_no := 'YJ' || coalesce(v_phone,'');

  select coalesce(data::jsonb,'[]'::jsonb)
    into v_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select elem into v_order
  from jsonb_array_elements(coalesce(v_orders,'[]'::jsonb)) elem
  where elem->>'paymentCode'=p_payment_code
    and (
      elem->>'memberId'=v_uid::text
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
    )
  limit 1;

  return v_order;
end;
$$;

-- 我的商品：只回傳目前登入會員的可兌換商品
create or replace function public.app_get_member_products()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_member_no text;
  v_products jsonb;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select phone into v_phone
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  v_member_no := 'YJ' || coalesce(v_phone,'');

  select coalesce(data::jsonb,'[]'::jsonb)
    into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select coalesce(jsonb_agg(elem),'[]'::jsonb)
    into v_result
  from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) elem
  where (
      elem->>'memberId'=v_uid::text
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid::text
      or elem->>'memberKey'=v_phone
    )
    and elem->>'status'='可兌換'
    and coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)>0
    and (
      nullif(elem->>'validUntil','') is null
      or (elem->>'validUntil')::timestamptz >= now()
    );

  return coalesce(v_result,'[]'::jsonb);
end;
$$;

revoke all on function public.app_create_store_checkout_order(jsonb) from public;
revoke all on function public.app_get_anybuy_order(text) from public;
revoke all on function public.app_get_member_products() from public;

grant execute on function public.app_create_store_checkout_order(jsonb) to authenticated;
grant execute on function public.app_get_anybuy_order(text) to authenticated;
grant execute on function public.app_get_member_products() to authenticated;

notify pgrst, 'reload schema';
