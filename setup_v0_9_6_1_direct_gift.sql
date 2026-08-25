
create extension if not exists pgcrypto;

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
  v_receiver_phone text := nullif(trim(coalesce(p_receiver_phone,'')),'');
  v_receiver_uid uuid;
  v_receiver_name text;
  v_receiver_member_no text;
  v_products jsonb:='[]'::jsonb;
  v_gifts jsonb:='[]'::jsonb;
  v_product jsonb;
  v_new_products jsonb:='[]'::jsonb;
  v_elem jsonb;
  v_remaining integer;
  v_gift_code text;
  v_delivery_mode text;
  v_new_gift jsonb;
  v_receiver_product jsonb;
  v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'invalid quantity'; end if;

  select phone,coalesce(name,'')
  into v_phone,v_name
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no:='YJ'||v_phone;

  if v_receiver_phone is not null then
    if v_receiver_phone=v_phone then
      raise exception 'cannot transfer to yourself';
    end if;

    select auth_user_id,coalesce(name,'')
    into v_receiver_uid,v_receiver_name
    from public.app_members
    where phone=v_receiver_phone
    limit 1;

    if v_receiver_uid is null then
      raise exception 'receiver is not a registered member';
    end if;

    v_receiver_member_no:='YJ'||v_receiver_phone;
    v_delivery_mode:='direct';
  else
    v_delivery_mode:='claim_code';
  end if;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1
  for update;

  if not found then raise exception 'member products not found'; end if;

  select elem
  into v_product
  from jsonb_array_elements(v_products) elem
  where elem->>'id'=p_member_product_id
    and (
      elem->>'memberId'=v_uid::text
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid::text
      or elem->>'memberKey'=v_phone
    )
  limit 1;

  if v_product is null then raise exception 'member product not found'; end if;
  if v_product->>'status'<>'可兌換' then raise exception 'product not transferable'; end if;

  v_remaining:=coalesce(nullif(v_product->>'remainingQuantity','')::integer,0);
  if p_quantity>v_remaining then raise exception 'quantity exceeds remaining'; end if;

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

  if v_delivery_mode='direct' then
    v_receiver_product:=jsonb_build_object(
      'id',gen_random_uuid()::text,
      'memberId',v_receiver_uid::text,
      'memberNo',v_receiver_member_no,
      'memberPhone',v_receiver_phone,
      'memberKey',v_receiver_uid::text,
      'memberName',v_receiver_name,
      'orderId',v_product->>'orderId',
      'productId',v_product->>'productId',
      'code',v_product->>'code',
      'name',v_product->>'name',
      'category',coalesce(v_product->>'category','隨買'),
      'originalQuantity',p_quantity,
      'remainingQuantity',p_quantity,
      'redeemedQuantity',0,
      'validityDays',v_product->>'validityDays',
      'validFrom',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
      'validUntil',v_product->>'validUntil',
      'activityContent',v_product->>'activityContent',
      'status','可兌換',
      'source','會員轉贈',
      'returnEligible',false,
      'giftFromMemberId',v_uid::text,
      'giftFromPhone',v_phone,
      'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
      'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
    );

    v_new_products:=v_new_products||jsonb_build_array(v_receiver_product);
  end if;

  update public.yijia_app_state
  set data=v_new_products,updated_at=now()
  where store_id='HQ' and data_key='yj_app_member_products';

  if v_delivery_mode='claim_code' then
    v_gift_code:='YG'
      ||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
      ||lpad((floor(random()*1000))::int::text,3,'0');
  else
    v_gift_code:=null;
  end if;

  v_new_gift:=jsonb_build_object(
    'id',gen_random_uuid()::text,
    'giftCode',v_gift_code,
    'deliveryMode',v_delivery_mode,
    'status',case when v_delivery_mode='direct' then '已轉贈' else '待領取' end,
    'senderMemberId',v_uid::text,
    'senderMemberNo',v_member_no,
    'senderPhone',v_phone,
    'senderName',v_name,
    'receiverMemberId',case when v_receiver_uid is null then null else v_receiver_uid::text end,
    'receiverMemberNo',v_receiver_member_no,
    'receiverPhone',v_receiver_phone,
    'receiverName',v_receiver_name,
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
    'deliveredAt',case when v_delivery_mode='direct'
      then to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
      else null end,
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_gifts
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_gifts'
  limit 1
  for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_gifts',jsonb_build_array(v_new_gift),now());
  else
    update public.yijia_app_state
    set data=v_gifts||jsonb_build_array(v_new_gift),updated_at=now()
    where store_id='HQ' and data_key='yj_app_gifts';
  end if;

  return v_new_gift;
end;
$$;

revoke all on function public.app_create_gift_transfer(text,integer,text) from public;
grant execute on function public.app_create_gift_transfer(text,integer,text) to authenticated;

notify pgrst,'reload schema';
