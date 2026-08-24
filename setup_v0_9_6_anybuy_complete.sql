
-- 億家 App v0.9.6 — 轉贈 / 領取 / 訂閱 / 預約 / 訂單明細
-- 共用 public.yijia_app_state
--
-- 新增正式 key：
-- HQ / yj_app_gifts
--
-- 預留讀取 key：
-- HQ / yj_app_subscriptions
-- HQ / yj_app_reservations

create extension if not exists pgcrypto;

create or replace function public.app_get_gift_transfer_data()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_phone text;
  v_member_no text;
  v_products jsonb:='[]'::jsonb;
  v_gifts jsonb:='[]'::jsonb;
  v_product_result jsonb:='[]'::jsonb;
  v_history_result jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select phone into v_phone from public.app_members where auth_user_id=v_uid limit 1;
  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_member_products' limit 1;

  select coalesce(jsonb_agg(elem),'[]'::jsonb) into v_product_result
  from jsonb_array_elements(v_products) elem
  where (
    elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or
    elem->>'memberPhone'=v_phone or elem->>'memberKey'=v_uid::text or elem->>'memberKey'=v_phone
  )
  and elem->>'status'='可兌換'
  and coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)>0
  and (nullif(elem->>'validUntil','') is null or (elem->>'validUntil')::timestamptz>=now());

  select coalesce(data::jsonb,'[]'::jsonb) into v_gifts
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_gifts' limit 1;

  select coalesce(jsonb_agg(elem order by elem->>'createdAt' desc),'[]'::jsonb)
  into v_history_result
  from jsonb_array_elements(v_gifts) elem
  where elem->>'senderMemberId'=v_uid::text
     or elem->>'senderPhone'=v_phone
     or elem->>'receiverMemberId'=v_uid::text
     or elem->>'receiverPhone'=v_phone;

  return jsonb_build_object(
    'products',coalesce(v_product_result,'[]'::jsonb),
    'history',coalesce(v_history_result,'[]'::jsonb)
  );
end;
$$;

create or replace function public.app_create_gift_transfer(
  p_member_product_id text,
  p_quantity integer,
  p_receiver_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_phone text;
  v_member_no text;
  v_name text;
  v_products jsonb:='[]'::jsonb;
  v_gifts jsonb:='[]'::jsonb;
  v_product jsonb;
  v_new_products jsonb:='[]'::jsonb;
  v_elem jsonb;
  v_remaining integer;
  v_gift_code text;
  v_new jsonb;
  v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'invalid quantity'; end if;

  select phone,coalesce(name,'') into v_phone,v_name
  from public.app_members where auth_user_id=v_uid limit 1;
  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1 for update;

  if not found then raise exception 'member products not found'; end if;

  select elem into v_product
  from jsonb_array_elements(v_products) elem
  where elem->>'id'=p_member_product_id
    and (
      elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or
      elem->>'memberPhone'=v_phone or elem->>'memberKey'=v_uid::text or elem->>'memberKey'=v_phone
    )
  limit 1;

  if v_product is null then raise exception 'member product not found'; end if;
  if v_product->>'status'<>'可兌換' then raise exception 'product not transferable'; end if;

  v_remaining:=coalesce(nullif(v_product->>'remainingQuantity','')::integer,0);
  if p_quantity>v_remaining then raise exception 'quantity exceeds remaining'; end if;

  v_gift_code:='YG'||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
    ||lpad((floor(random()*1000))::int::text,3,'0');

  for v_elem in select value from jsonb_array_elements(v_products)
  loop
    if v_elem->>'id'=p_member_product_id then
      v_elem:=v_elem||jsonb_build_object(
        'remainingQuantity',v_remaining-p_quantity,
        'transferredQuantity',coalesce(nullif(v_elem->>'transferredQuantity','')::integer,0)+p_quantity,
        'status',case when v_remaining-p_quantity<=0 then '已轉贈完畢' else '可兌換' end,
        'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
      );
    end if;
    v_new_products:=v_new_products||jsonb_build_array(v_elem);
  end loop;

  update public.yijia_app_state
  set data=v_new_products,updated_at=now()
  where store_id='HQ' and data_key='yj_app_member_products';

  v_new:=jsonb_build_object(
    'id',gen_random_uuid()::text,
    'giftCode',v_gift_code,
    'status','待領取',
    'senderMemberId',v_uid::text,
    'senderMemberNo',v_member_no,
    'senderPhone',v_phone,
    'senderName',v_name,
    'receiverPhone',nullif(trim(coalesce(p_receiver_phone,'')),''),
    'memberProductId',v_product->>'id',
    'orderId',v_product->>'orderId',
    'productId',v_product->>'productId',
    'code',v_product->>'code',
    'name',v_product->>'name',
    'category',v_product->>'category',
    'quantity',p_quantity,
    'validityDays',v_product->>'validityDays',
    'validUntil',v_product->>'validUntil',
    'activityContent',v_product->>'activityContent',
    'source','會員轉贈',
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  select coalesce(data::jsonb,'[]'::jsonb) into v_gifts
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_gifts'
  limit 1 for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_gifts',jsonb_build_array(v_new),now());
  else
    update public.yijia_app_state
    set data=v_gifts||jsonb_build_array(v_new),updated_at=now()
    where store_id='HQ' and data_key='yj_app_gifts';
  end if;

  return v_new;
end;
$$;

create or replace function public.app_claim_gift_transfer(p_gift_code text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_phone text;
  v_member_no text;
  v_name text;
  v_gifts jsonb:='[]'::jsonb;
  v_products jsonb:='[]'::jsonb;
  v_gift jsonb;
  v_elem jsonb;
  v_new_gifts jsonb:='[]'::jsonb;
  v_new_product jsonb;
  v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone,coalesce(name,'') into v_phone,v_name
  from public.app_members where auth_user_id=v_uid limit 1;
  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_gifts
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_gifts'
  limit 1 for update;

  if not found then raise exception 'gift not found'; end if;

  select elem into v_gift
  from jsonb_array_elements(v_gifts) elem
  where upper(elem->>'giftCode')=upper(p_gift_code)
  limit 1;

  if v_gift is null then raise exception 'gift not found'; end if;
  if v_gift->>'status'<>'待領取' then raise exception 'gift already claimed or unavailable'; end if;
  if v_gift->>'senderMemberId'=v_uid::text then raise exception 'cannot claim your own gift'; end if;
  if nullif(v_gift->>'receiverPhone','') is not null and v_gift->>'receiverPhone'<>v_phone then
    raise exception 'gift is assigned to another member';
  end if;

  v_new_product:=jsonb_build_object(
    'id',gen_random_uuid()::text,
    'memberId',v_uid::text,
    'memberNo',v_member_no,
    'memberPhone',v_phone,
    'memberKey',v_uid::text,
    'orderId',v_gift->>'orderId',
    'productId',v_gift->>'productId',
    'code',v_gift->>'code',
    'name',v_gift->>'name',
    'category',coalesce(v_gift->>'category','隨買'),
    'originalQuantity',coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'remainingQuantity',coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'validityDays',v_gift->>'validityDays',
    'validFrom',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'validUntil',v_gift->>'validUntil',
    'activityContent',v_gift->>'activityContent',
    'status','可兌換',
    'source','會員轉贈',
    'giftCode',v_gift->>'giftCode',
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1 for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_member_products',jsonb_build_array(v_new_product),now());
  else
    update public.yijia_app_state
    set data=v_products||jsonb_build_array(v_new_product),updated_at=now()
    where store_id='HQ' and data_key='yj_app_member_products';
  end if;

  for v_elem in select value from jsonb_array_elements(v_gifts)
  loop
    if upper(v_elem->>'giftCode')=upper(p_gift_code) then
      v_elem:=v_elem||jsonb_build_object(
        'status','已領取',
        'receiverMemberId',v_uid::text,
        'receiverMemberNo',v_member_no,
        'receiverPhone',v_phone,
        'receiverName',v_name,
        'claimedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
        'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
      );
    end if;
    v_new_gifts:=v_new_gifts||jsonb_build_array(v_elem);
  end loop;

  update public.yijia_app_state
  set data=v_new_gifts,updated_at=now()
  where store_id='HQ' and data_key='yj_app_gifts';

  return jsonb_build_object(
    'giftCode',p_gift_code,
    'name',v_gift->>'name',
    'quantity',coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'status','已領取'
  );
end;
$$;

create or replace function public.app_get_member_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_phone text;
  v_member_no text;
  v_data jsonb:='[]'::jsonb;
  v_result jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select phone into v_phone from public.app_members where auth_user_id=v_uid limit 1;
  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_data
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_subscriptions' limit 1;

  select coalesce(jsonb_agg(elem order by elem->>'createdAt' desc),'[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_data) elem
  where elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or elem->>'memberPhone'=v_phone;

  return v_result;
end;
$$;

create or replace function public.app_get_member_reservations()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_phone text;
  v_member_no text;
  v_data jsonb:='[]'::jsonb;
  v_result jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select phone into v_phone from public.app_members where auth_user_id=v_uid limit 1;
  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_data
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_reservations' limit 1;

  select coalesce(jsonb_agg(elem order by elem->>'createdAt' desc),'[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_data) elem
  where elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or elem->>'memberPhone'=v_phone;

  return v_result;
end;
$$;

revoke all on function public.app_get_gift_transfer_data() from public;
revoke all on function public.app_create_gift_transfer(text,integer,text) from public;
revoke all on function public.app_claim_gift_transfer(text) from public;
revoke all on function public.app_get_member_subscriptions() from public;
revoke all on function public.app_get_member_reservations() from public;

grant execute on function public.app_get_gift_transfer_data() to authenticated;
grant execute on function public.app_create_gift_transfer(text,integer,text) to authenticated;
grant execute on function public.app_claim_gift_transfer(text) to authenticated;
grant execute on function public.app_get_member_subscriptions() to authenticated;
grant execute on function public.app_get_member_reservations() to authenticated;

notify pgrst,'reload schema';
