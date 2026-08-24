
-- 億家 App v0.9.4 — 億家Pay付款方式 + 7天未兌換退貨
-- 核心共用 table：public.yijia_app_state
--
-- 新增 key：
-- HQ / yj_app_return_requests
-- HQ / yj_app_yijiapay_wallets
-- HQ / yj_app_payment_methods
-- HQ / yj_app_yijiapay_orders
--
-- 注意：
-- 1. 信用卡卡號/CVV 不可寫入 Supabase。正式綁卡與扣款要使用金流服務商 Token。
-- 2. 這份 SQL 會建立安全 RPC 與訂單/退貨資料流。
-- 3. 信用卡與錢包「真正扣款」仍需後端/金流服務完成後，才可把訂單標記 paid。

create extension if not exists pgcrypto;

-- ---------- helper: 目前會員 ----------
create or replace function public.app_current_member_json()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone,coalesce(name,'')
  into v_phone,v_name
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;

  return jsonb_build_object(
    'memberId',v_uid::text,
    'memberNo','YJ'||v_phone,
    'memberPhone',v_phone,
    'memberName',v_name
  );
end;
$$;

-- ---------- 億家Pay摘要 ----------
create or replace function public.app_get_yijiapay_summary()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_wallets jsonb := '[]'::jsonb;
  v_methods jsonb := '[]'::jsonb;
  v_wallet jsonb;
  v_card jsonb;
begin
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_wallets
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_wallets'
  limit 1;

  select elem into v_wallet
  from jsonb_array_elements(coalesce(v_wallets,'[]'::jsonb)) elem
  where elem->>'memberId'=v_uid
     or elem->>'memberPhone'=v_phone
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_methods
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_payment_methods'
  limit 1;

  select elem into v_card
  from jsonb_array_elements(coalesce(v_methods,'[]'::jsonb)) elem
  where (elem->>'memberId'=v_uid or elem->>'memberPhone'=v_phone)
    and elem->>'type'='card'
    and coalesce((elem->>'active')::boolean,true)=true
  limit 1;

  return jsonb_build_object(
    'walletBalance',coalesce(nullif(v_wallet->>'balance','')::numeric,0),
    'hasCard',(v_card is not null),
    'cardLabel',coalesce(v_card->>'displayName',
        case when v_card is not null then '已綁定信用卡' else '尚未綁定' end)
  );
end;
$$;

-- ---------- 億家Pay訂單 ----------
create or replace function public.app_create_yijiapay_order(
  p_items jsonb,
  p_payment_source text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_now timestamptz := now();
  v_order_id text;
  v_uuid text := gen_random_uuid()::text;
  v_item jsonb;
  v_product jsonb;
  v_product_key text;
  v_cart_qty integer;
  v_bundle_qty integer;
  v_price numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_wallet_balance numeric := 0;
  v_has_card boolean := false;
  v_summary jsonb;
  v_new jsonb;
begin
  if p_payment_source not in ('wallet','card') then
    raise exception 'invalid payment source';
  end if;

  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'cart is empty';
  end if;

  v_summary := public.app_get_yijiapay_summary();
  v_wallet_balance := coalesce((v_summary->>'walletBalance')::numeric,0);
  v_has_card := coalesce((v_summary->>'hasCard')::boolean,false);

  if p_payment_source='card' and not v_has_card then
    raise exception 'no bound card';
  end if;

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
    v_total := v_total + (v_price*v_cart_qty);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId',coalesce(v_product->>'id',v_product->>'code'),
      'code',coalesce(v_product->>'code',v_product_key),
      'name',coalesce(v_product->>'name','商品'),
      'category',coalesce(v_product->>'category','隨買'),
      'price',v_price,
      'quantity',v_bundle_qty*v_cart_qty,
      'cartQuantity',v_cart_qty,
      'validityDays',greatest(0,coalesce(nullif(v_product->>'validityDays','')::integer,0)),
      'activityStartDate',coalesce(v_product->>'activityStartDate',''),
      'activityEndDate',coalesce(v_product->>'activityEndDate',''),
      'activityContent',coalesce(v_product->>'activityContent','')
    ));
  end loop;

  if p_payment_source='wallet' and v_wallet_balance<v_total then
    raise exception 'wallet balance insufficient';
  end if;

  v_order_id := 'YP' ||
    to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS') ||
    lpad((floor(random()*1000))::int::text,3,'0');

  v_new := jsonb_build_object(
    'id',v_uuid,
    'orderId',v_order_id,
    'memberId',v_m->>'memberId',
    'memberNo',v_m->>'memberNo',
    'memberPhone',v_m->>'memberPhone',
    'memberName',v_m->>'memberName',
    'paymentMethod','億家Pay',
    'paymentSource',p_payment_source,
    'status','待支付',
    'paymentStatus','pending',
    'total',v_total,
    'items',v_items,
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_orders'
  limit 1
  for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_yijiapay_orders',jsonb_build_array(v_new),now());
  else
    update public.yijia_app_state
    set data=v_orders||jsonb_build_array(v_new),updated_at=now()
    where store_id='HQ' and data_key='yj_app_yijiapay_orders';
  end if;

  return v_new;
end;
$$;

-- ---------- 我的商品（含退貨資格） ----------
create or replace function public.app_get_member_products()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_member_no text := v_m->>'memberNo';
  v_products jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_store_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_req jsonb;
  v_order jsonb;
  v_purchase_at timestamptz;
  v_deadline timestamptz;
  v_return_eligible boolean;
  v_return_status text;
  v_result jsonb := '[]'::jsonb;
begin
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_returns
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_return_requests'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_store_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_pay_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_orders'
  limit 1;

  for v_elem in
    select elem
    from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) elem
    where (
      elem->>'memberId'=v_uid
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid
      or elem->>'memberKey'=v_phone
    )
    and elem->>'status'='可兌換'
    and coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)>0
    and (
      nullif(elem->>'validUntil','') is null
      or (elem->>'validUntil')::timestamptz>=now()
    )
  loop
    v_req := null;
    select r into v_req
    from jsonb_array_elements(coalesce(v_returns,'[]'::jsonb)) r
    where r->>'memberProductId'=v_elem->>'id'
      and coalesce(r->>'status','') not in ('已取消','已駁回')
    order by coalesce(r->>'createdAt','') desc
    limit 1;

    v_return_status := case when v_req is null then null else v_req->>'status' end;

    v_order := null;
    if nullif(v_elem->>'paymentCode','') is not null then
      select o into v_order
      from jsonb_array_elements(coalesce(v_store_orders,'[]'::jsonb)) o
      where o->>'paymentCode'=v_elem->>'paymentCode'
         or o->>'orderId'=v_elem->>'orderId'
      limit 1;
    end if;

    if v_order is null and nullif(v_elem->>'orderId','') is not null then
      select o into v_order
      from jsonb_array_elements(coalesce(v_pay_orders,'[]'::jsonb)) o
      where o->>'orderId'=v_elem->>'orderId'
      limit 1;
    end if;

    begin
      v_purchase_at := coalesce(
        nullif(v_order->>'paidAt','')::timestamptz,
        nullif(v_elem->>'createdAt','')::timestamptz
      );
    exception when others then
      v_purchase_at := null;
    end;

    v_deadline := case when v_purchase_at is null then null else v_purchase_at + interval '7 days' end;

    v_return_eligible :=
      v_req is null
      and coalesce(nullif(v_elem->>'originalQuantity','')::numeric,0)>0
      and coalesce(nullif(v_elem->>'originalQuantity','')::numeric,0)
          = coalesce(nullif(v_elem->>'remainingQuantity','')::numeric,0)
      and v_deadline is not null
      and now()<=v_deadline;

    v_result := v_result || jsonb_build_array(
      v_elem ||
      jsonb_build_object(
        'returnEligible',v_return_eligible,
        'returnDeadline',case when v_deadline is null then null
          else to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00' end,
        'returnRequestStatus',v_return_status,
        'returnMode',case
          when coalesce(v_elem->>'source','')='店舖結帳'
            or nullif(v_elem->>'paidStoreCode','') is not null
          then 'original_store'
          else 'online'
        end,
        'paidStoreName',coalesce(v_elem->>'paidStoreName',v_order->>'paidStoreName'),
        'paidStoreCode',coalesce(v_elem->>'paidStoreCode',v_order->>'paidStoreCode')
      )
    );
  end loop;

  return v_result;
end;
$$;

-- ---------- 建立退貨申請 ----------
create or replace function public.app_create_return_request(
  p_member_product_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_member_no text := v_m->>'memberNo';
  v_products jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_store_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_product jsonb;
  v_existing jsonb;
  v_order jsonb;
  v_purchase_at timestamptz;
  v_deadline timestamptz;
  v_mode text;
  v_return_code text;
  v_new jsonb;
  v_now timestamptz:=now();
begin
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select elem into v_product
  from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) elem
  where elem->>'id'=p_member_product_id
    and (
      elem->>'memberId'=v_uid
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid
      or elem->>'memberKey'=v_phone
    )
  limit 1;

  if v_product is null then raise exception 'member product not found'; end if;
  if v_product->>'status'<>'可兌換' then raise exception 'product is not returnable'; end if;

  if coalesce(nullif(v_product->>'originalQuantity','')::numeric,0)
     <> coalesce(nullif(v_product->>'remainingQuantity','')::numeric,0) then
    raise exception 'redeemed product cannot be returned';
  end if;

  if coalesce(nullif(v_product->>'originalQuantity','')::numeric,0)<=0 then
    raise exception 'invalid product quantity';
  end if;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_returns
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_return_requests'
  limit 1
  for update;

  if found then
    select r into v_existing
    from jsonb_array_elements(coalesce(v_returns,'[]'::jsonb)) r
    where r->>'memberProductId'=p_member_product_id
      and coalesce(r->>'status','') not in ('已取消','已駁回')
    limit 1;
    if v_existing is not null then raise exception 'return request already exists'; end if;
  end if;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_store_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  if nullif(v_product->>'paymentCode','') is not null
     or nullif(v_product->>'paidStoreCode','') is not null then
    select o into v_order
    from jsonb_array_elements(coalesce(v_store_orders,'[]'::jsonb)) o
    where o->>'paymentCode'=v_product->>'paymentCode'
       or o->>'orderId'=v_product->>'orderId'
    limit 1;
  end if;

  if v_order is null then
    select coalesce(data::jsonb,'[]'::jsonb)
    into v_pay_orders
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_yijiapay_orders'
    limit 1;

    select o into v_order
    from jsonb_array_elements(coalesce(v_pay_orders,'[]'::jsonb)) o
    where o->>'orderId'=v_product->>'orderId'
    limit 1;
  end if;

  begin
    v_purchase_at := coalesce(
      nullif(v_order->>'paidAt','')::timestamptz,
      nullif(v_product->>'createdAt','')::timestamptz
    );
  exception when others then
    v_purchase_at:=null;
  end;

  if v_purchase_at is null then raise exception 'purchase time unavailable'; end if;
  v_deadline:=v_purchase_at+interval '7 days';
  if now()>v_deadline then raise exception 'return period expired'; end if;

  v_mode := case
    when coalesce(v_product->>'source','')='店舖結帳'
      or nullif(v_product->>'paidStoreCode','') is not null
    then 'original_store'
    else 'online'
  end;

  if v_mode='original_store'
     and coalesce(v_product->>'paidStoreCode',v_order->>'paidStoreCode','')='' then
    raise exception 'original paid store unavailable';
  end if;

  v_return_code:='YR'||
    to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')||
    lpad((floor(random()*1000))::int::text,3,'0');

  v_new:=jsonb_build_object(
    'id',gen_random_uuid()::text,
    'returnCode',v_return_code,
    'memberProductId',v_product->>'id',
    'memberId',v_m->>'memberId',
    'memberNo',v_m->>'memberNo',
    'memberPhone',v_m->>'memberPhone',
    'memberName',v_m->>'memberName',
    'orderId',v_product->>'orderId',
    'paymentCode',v_product->>'paymentCode',
    'productId',v_product->>'productId',
    'code',v_product->>'code',
    'name',v_product->>'name',
    'quantity',coalesce(nullif(v_product->>'remainingQuantity','')::numeric,0),
    'returnMode',v_mode,
    'status',case when v_mode='original_store' then '待回原門市辦理' else '待線上退款' end,
    'paidStoreCode',coalesce(v_product->>'paidStoreCode',v_order->>'paidStoreCode'),
    'paidStoreName',coalesce(v_product->>'paidStoreName',v_order->>'paidStoreName'),
    'tmSaleId',coalesce(v_product->>'tmSaleId',v_order->>'tmSaleId'),
    'purchaseAt',to_char(v_purchase_at at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'returnDeadline',to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_return_requests',jsonb_build_array(v_new),now());
  else
    update public.yijia_app_state
    set data=v_returns||jsonb_build_array(v_new),updated_at=now()
    where store_id='HQ' and data_key='yj_app_return_requests';
  end if;

  return v_new;
end;
$$;

-- ---------- permissions ----------
revoke all on function public.app_current_member_json() from public;
revoke all on function public.app_get_yijiapay_summary() from public;
revoke all on function public.app_create_yijiapay_order(jsonb,text) from public;
revoke all on function public.app_get_member_products() from public;
revoke all on function public.app_create_return_request(text) from public;

grant execute on function public.app_current_member_json() to authenticated;
grant execute on function public.app_get_yijiapay_summary() to authenticated;
grant execute on function public.app_create_yijiapay_order(jsonb,text) to authenticated;
grant execute on function public.app_get_member_products() to authenticated;
grant execute on function public.app_create_return_request(text) to authenticated;

notify pgrst,'reload schema';
