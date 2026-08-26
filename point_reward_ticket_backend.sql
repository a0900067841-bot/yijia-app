-- 億家 App v0.10.9.3 Point Reward QR
-- 點數兌換後產生 PR 兌換券，供 App 顯示 QR、TM 掃描與完成兌換。
-- 沿用既有 app_point_reward_redemptions，不改點數比例與扣點核心。

begin;

alter table public.app_point_reward_redemptions
  add column if not exists fulfillment_status text not null default 'available',
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfilled_store_code text,
  add column if not exists tm_sale_id text;

create index if not exists idx_app_point_reward_redemptions_fulfillment
  on public.app_point_reward_redemptions(fulfillment_code, fulfillment_status);

-- 舊資料：有 fulfillment_code 且尚無狀態時視為 available。
update public.app_point_reward_redemptions
set fulfillment_status='available'
where coalesce(fulfillment_status,'')='';

-- App 查自己的 PR 兌換券狀態。
create or replace function public.app_get_point_reward_ticket_status(
  p_fulfillment_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.app_point_reward_redemptions%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select * into v_row
  from public.app_point_reward_redemptions
  where fulfillment_code=trim(p_fulfillment_code)
    and auth_user_id=v_uid
  limit 1;

  if v_row.id is null then
    raise exception 'point reward ticket not found';
  end if;

  return jsonb_build_object(
    'fulfillmentCode',v_row.fulfillment_code,
    'fulfillmentStatus',coalesce(v_row.fulfillment_status,'available'),
    'rewardCode',v_row.reward_code,
    'rewardName',v_row.reward_name,
    'quantity',v_row.quantity,
    'pointsUsed',v_row.points_used,
    'fulfilledAt',v_row.fulfilled_at,
    'fulfilledStoreCode',v_row.fulfilled_store_code,
    'tmSaleId',v_row.tm_sale_id
  );
end;
$$;

-- TM 掃 PR 碼：取得兌換內容，但此步不修改狀態。
create or replace function public.tm_get_point_reward_ticket(
  p_fulfillment_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.app_point_reward_redemptions%rowtype;
begin
  select * into v_row
  from public.app_point_reward_redemptions
  where fulfillment_code=trim(p_fulfillment_code)
  limit 1;

  if v_row.id is null then
    raise exception 'point reward ticket not found';
  end if;

  if v_row.status<>'completed' then
    raise exception 'point reward redemption unavailable';
  end if;

  if coalesce(v_row.fulfillment_status,'available')<>'available' then
    raise exception 'point reward ticket already used';
  end if;

  return jsonb_build_object(
    'fulfillmentCode',v_row.fulfillment_code,
    'rewardCode',v_row.reward_code,
    'rewardName',v_row.reward_name,
    'quantity',v_row.quantity,
    'pointsUsed',v_row.points_used,
    'payload',v_row.payload,
    'status','available'
  );
end;
$$;

-- TM 實際交付兌換商品／權益成功後才呼叫。
create or replace function public.tm_complete_point_reward_ticket(
  p_fulfillment_code text,
  p_store_code text,
  p_tm_sale_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.app_point_reward_redemptions%rowtype;
begin
  select * into v_row
  from public.app_point_reward_redemptions
  where fulfillment_code=trim(p_fulfillment_code)
  for update;

  if v_row.id is null then
    raise exception 'point reward ticket not found';
  end if;

  if v_row.status<>'completed' then
    raise exception 'point reward redemption unavailable';
  end if;

  if coalesce(v_row.fulfillment_status,'available')='used' then
    raise exception 'point reward ticket already used';
  end if;

  update public.app_point_reward_redemptions
  set fulfillment_status='used',
      fulfilled_at=now(),
      fulfilled_store_code=p_store_code,
      tm_sale_id=p_tm_sale_id,
      updated_at=now()
  where id=v_row.id;

  return jsonb_build_object(
    'ok',true,
    'fulfillmentCode',v_row.fulfillment_code,
    'rewardCode',v_row.reward_code,
    'rewardName',v_row.reward_name,
    'quantity',v_row.quantity,
    'fulfillmentStatus','used',
    'fulfilledAt',now()
  );
end;
$$;

revoke all on function public.app_get_point_reward_ticket_status(text) from public;
grant execute on function public.app_get_point_reward_ticket_status(text) to authenticated;

grant execute on function public.tm_get_point_reward_ticket(text) to authenticated;
grant execute on function public.tm_complete_point_reward_ticket(text,text,text) to authenticated;

notify pgrst,'reload schema';

commit;
