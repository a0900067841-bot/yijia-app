
-- 億家 App v0.9.6.3
-- 商品使用紀錄分成：
-- 轉贈：目前會員是 sender
-- 禮物：目前會員是 receiver

create or replace function public.app_get_product_usage_history()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_member_no text;

  v_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_redemptions jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_gifts jsonb := '[]'::jsonb;

  v_purchase_result jsonb := '[]'::jsonb;
  v_redemption_result jsonb := '[]'::jsonb;
  v_return_result jsonb := '[]'::jsonb;
  v_expired_result jsonb := '[]'::jsonb;
  v_gift_result jsonb := '[]'::jsonb;
  v_transfer_result jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone into v_phone
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no := 'YJ' || v_phone;

  select coalesce(data::jsonb,'[]'::jsonb) into v_orders
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_anybuy_orders' limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_pay_orders
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_yijiapay_orders' limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_redemptions
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_redemptions' limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_returns
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_return_requests' limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_member_products' limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_gifts
  from public.yijia_app_state where store_id='HQ' and data_key='yj_app_gifts' limit 1;

  select coalesce(jsonb_agg(x order by coalesce(x->>'paidAt',x->>'createdAt') desc),'[]'::jsonb)
  into v_purchase_result
  from (
    select elem as x from jsonb_array_elements(v_orders) elem
    where elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or elem->>'memberPhone'=v_phone
    union all
    select elem as x from jsonb_array_elements(v_pay_orders) elem
    where elem->>'memberId'=v_uid::text or elem->>'memberNo'=v_member_no or elem->>'memberPhone'=v_phone
  ) q;

  select coalesce(jsonb_agg(elem order by coalesce(elem->>'redeemedAt',elem->>'createdAt') desc),'[]'::jsonb)
  into v_redemption_result
  from jsonb_array_elements(v_redemptions) elem
  where elem->>'memberId'=v_uid::text
     or elem->>'memberNo'=v_member_no
     or elem->>'memberPhone'=v_phone;

  select coalesce(jsonb_agg(elem order by coalesce(elem->>'refundedAt',elem->>'createdAt') desc),'[]'::jsonb)
  into v_return_result
  from jsonb_array_elements(v_returns) elem
  where elem->>'memberId'=v_uid::text
     or elem->>'memberNo'=v_member_no
     or elem->>'memberPhone'=v_phone;

  select coalesce(jsonb_agg(elem order by elem->>'validUntil' desc),'[]'::jsonb)
  into v_expired_result
  from jsonb_array_elements(v_products) elem
  where (
      elem->>'memberId'=v_uid::text
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid::text
      or elem->>'memberKey'=v_phone
    )
    and nullif(elem->>'validUntil','') is not null
    and (elem->>'validUntil')::timestamptz < now()
    and coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)>0;

  -- 禮物：我是收禮人
  select coalesce(
    jsonb_agg(elem order by coalesce(elem->>'claimedAt',elem->>'deliveredAt',elem->>'createdAt') desc),
    '[]'::jsonb
  )
  into v_gift_result
  from jsonb_array_elements(v_gifts) elem
  where elem->>'receiverMemberId'=v_uid::text
     or elem->>'receiverPhone'=v_phone;

  -- 轉贈：我是轉贈人
  select coalesce(
    jsonb_agg(elem order by coalesce(elem->>'deliveredAt',elem->>'createdAt') desc),
    '[]'::jsonb
  )
  into v_transfer_result
  from jsonb_array_elements(v_gifts) elem
  where elem->>'senderMemberId'=v_uid::text
     or elem->>'senderPhone'=v_phone;

  return jsonb_build_object(
    'purchases',coalesce(v_purchase_result,'[]'::jsonb),
    'redemptions',coalesce(v_redemption_result,'[]'::jsonb),
    'returns',coalesce(v_return_result,'[]'::jsonb),
    'expired',coalesce(v_expired_result,'[]'::jsonb),
    'gifts',coalesce(v_gift_result,'[]'::jsonb),
    'transfers',coalesce(v_transfer_result,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.app_get_product_usage_history() from public;
grant execute on function public.app_get_product_usage_history() to authenticated;

notify pgrst,'reload schema';
