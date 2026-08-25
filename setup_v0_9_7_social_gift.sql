
-- 億家 App v0.9.7 — 社群轉贈完整流程
--
-- 規則：
-- 1. 指定手機：仍由 app_create_gift_transfer() 直接轉入對方 App。
-- 2. 手機留白：建立 YG 單次領取碼（deliveryMode = claim_code）。
-- 3. YG 可由手動輸入、掃 CODE128、分享連結 ?gift=YG... 帶入。
-- 4. 成功領取後立即改為「已領取」，同一 YG 不可再次領取。
-- 5. 收禮商品直接加入 HQ / yj_app_member_products。
-- 6. 收禮商品沿用原有效期限，不因轉贈延長。
-- 7. 轉贈取得的商品不可退貨。

create extension if not exists pgcrypto;

drop function if exists public.app_claim_gift_transfer(text);

create function public.app_claim_gift_transfer(p_gift_code text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_name text;
  v_member_no text;

  v_code text := upper(trim(coalesce(p_gift_code,'')));
  v_gifts jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_gift jsonb;
  v_elem jsonb;
  v_new_gifts jsonb := '[]'::jsonb;
  v_new_product jsonb;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_code = '' then
    raise exception 'gift code is required';
  end if;

  select phone, coalesce(name,'')
  into v_phone, v_name
  from public.app_members
  where auth_user_id = v_uid
  limit 1;

  if v_phone is null then
    raise exception 'member profile not found';
  end if;

  v_member_no := 'YJ' || v_phone;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_gifts
  from public.yijia_app_state
  where store_id='HQ'
    and data_key='yj_app_gifts'
  limit 1
  for update;

  if not found then
    raise exception 'gift not found';
  end if;

  select elem
  into v_gift
  from jsonb_array_elements(v_gifts) elem
  where upper(coalesce(elem->>'giftCode','')) = v_code
  limit 1;

  if v_gift is null then
    raise exception 'gift not found';
  end if;

  if coalesce(v_gift->>'deliveryMode','') <> 'claim_code' then
    raise exception 'this gift does not require claiming';
  end if;

  if coalesce(v_gift->>'status','') <> '待領取' then
    raise exception 'gift already claimed or unavailable';
  end if;

  if v_gift->>'senderMemberId' = v_uid::text
     or v_gift->>'senderPhone' = v_phone then
    raise exception 'cannot claim your own gift';
  end if;

  -- 若舊資料曾指定 receiverPhone，仍遵守指定對象限制
  if nullif(v_gift->>'receiverPhone','') is not null
     and v_gift->>'receiverPhone' <> v_phone then
    raise exception 'gift is assigned to another member';
  end if;

  -- 原商品若已逾期，禮物不得領取
  if nullif(v_gift->>'validUntil','') is not null
     and (v_gift->>'validUntil')::timestamptz < now() then
    raise exception 'gift product expired';
  end if;

  v_new_product := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'memberId', v_uid::text,
    'memberNo', v_member_no,
    'memberPhone', v_phone,
    'memberKey', v_uid::text,
    'memberName', v_name,

    'orderId', v_gift->>'orderId',
    'productId', v_gift->>'productId',
    'code', v_gift->>'code',
    'name', v_gift->>'name',
    'category', coalesce(v_gift->>'category','隨買'),

    'originalQuantity', coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'remainingQuantity', coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'redeemedQuantity', 0,

    'validityDays', v_gift->>'validityDays',
    'validFrom', to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
    'validUntil', v_gift->>'validUntil',
    'activityContent', v_gift->>'activityContent',

    'status', '可兌換',
    'source', '會員轉贈',
    'returnEligible', false,
    'giftCode', v_code,
    'giftFromMemberId', v_gift->>'senderMemberId',
    'giftFromPhone', v_gift->>'senderPhone',

    'createdAt', to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
    'updatedAt', to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'
  );

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ'
    and data_key='yj_app_member_products'
  limit 1
  for update;

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_member_products',jsonb_build_array(v_new_product),now());
  else
    update public.yijia_app_state
    set data = v_products || jsonb_build_array(v_new_product),
        updated_at = now()
    where store_id='HQ'
      and data_key='yj_app_member_products';
  end if;

  -- 同一 YG 立即變成已領取，並補收禮人資料
  for v_elem in
    select value from jsonb_array_elements(v_gifts)
  loop
    if upper(coalesce(v_elem->>'giftCode','')) = v_code then
      v_elem := v_elem || jsonb_build_object(
        'status','已領取',
        'receiverMemberId',v_uid::text,
        'receiverMemberNo',v_member_no,
        'receiverPhone',v_phone,
        'receiverName',v_name,
        'claimedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
        'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'
      );
    end if;
    v_new_gifts := v_new_gifts || jsonb_build_array(v_elem);
  end loop;

  update public.yijia_app_state
  set data = v_new_gifts,
      updated_at = now()
  where store_id='HQ'
    and data_key='yj_app_gifts';

  return jsonb_build_object(
    'giftCode',v_code,
    'name',v_gift->>'name',
    'quantity',coalesce(nullif(v_gift->>'quantity','')::integer,0),
    'status','已領取'
  );
end;
$$;

revoke all on function public.app_claim_gift_transfer(text) from public;
grant execute on function public.app_claim_gift_transfer(text) to authenticated;

notify pgrst,'reload schema';
