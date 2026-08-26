-- 億家 App v0.10.9.4 Points Live Sync
-- 修正：
-- 1. App 點數餘額直接同步 TM / SC 共用的 HQ yj4_members。
-- 2. App 點數折抵規則直接讀現有 yj_point_settings。
-- 3. 不要求等下一筆 TM 交易才讓 App 看見既有點數。

begin;

-- =========================================================
-- A. App 主動從 HQ 會員主檔同步自己的目前點數
-- =========================================================
create or replace function public.app_sync_my_points_from_hq()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_members jsonb := '[]'::jsonb;
  v_member jsonb;
  v_balance integer := 0;
  v_existing integer := 0;
  v_expiring integer := 0;
  v_expiry date;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select regexp_replace(coalesce(phone,''),'[^0-9]','','g')
    into v_phone
  from public.app_members
  where auth_user_id=v_uid
  order by updated_at desc nulls last
  limit 1;

  if coalesce(v_phone,'')='' then
    raise exception 'member phone not found';
  end if;

  select coalesce(data::jsonb,'[]'::jsonb)
    into v_members
  from public.yijia_app_state
  where store_id='HQ'
    and data_key='yj4_members'
  order by updated_at desc
  limit 1;

  if jsonb_typeof(v_members)='array' then
    select elem
      into v_member
    from jsonb_array_elements(v_members) elem
    where regexp_replace(coalesce(elem->>'phone',''),'[^0-9]','','g')=v_phone
       or coalesce(elem->>'authUserId',elem->>'auth_user_id','')=v_uid::text
    limit 1;
  end if;

  if v_member is not null then
    v_balance := coalesce(nullif(v_member->>'points','')::integer,0);
  else
    select coalesce(available_points,0),
           coalesce(expiring_points,0),
           expiry_date
      into v_existing,v_expiring,v_expiry
    from public.app_points
    where auth_user_id=v_uid
    limit 1;

    v_balance := coalesce(v_existing,0);
  end if;

  -- 保留 App 已有的到期點數資訊；目前 HQ 主檔的 points 是總餘額來源。
  select coalesce(expiring_points,0),expiry_date
    into v_expiring,v_expiry
  from public.app_points
  where auth_user_id=v_uid
  limit 1;

  update public.app_points
  set phone=v_phone,
      available_points=v_balance,
      updated_at=now()
  where auth_user_id=v_uid;

  if not found then
    insert into public.app_points(
      auth_user_id,
      phone,
      available_points,
      expiring_points,
      updated_at
    )
    values(
      v_uid,
      v_phone,
      v_balance,
      coalesce(v_expiring,0),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'phone',v_phone,
    'availablePoints',v_balance,
    'expiringPoints',coalesce(v_expiring,0),
    'expiryDate',v_expiry,
    'source',case when v_member is not null then 'HQ:yj4_members' else 'app_points' end,
    'updatedAt',now()
  );
end;
$$;

revoke all on function public.app_sync_my_points_from_hq() from public;
grant execute on function public.app_sync_my_points_from_hq() to authenticated;


-- =========================================================
-- B. App 點數功能設定：直接同步既有 yj_point_settings
--    yj_point_settings 欄位：
--      earnAmount / earnPoints
--      redeemPoints / redeemAmount
-- =========================================================
create or replace function public.app_get_point_feature_config()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.app_point_feature_settings%rowtype;
  v_legacy jsonb;
  v_sync jsonb;
  v_available integer := 0;

  v_unit_points integer := 300;
  v_unit_amount numeric(12,2) := 1;
  v_discount_enabled boolean := false;
  v_reward_enabled boolean := false;
  v_max_discount numeric(5,2) := 100;
  v_min_order numeric(12,2) := 0;
  v_earn_amount integer := 1;
  v_earn_points integer := 1;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select *
    into v_cfg
  from public.app_point_feature_settings
  where id='default'
  limit 1;

  if found then
    v_unit_points := coalesce(v_cfg.redeem_unit_points,300);
    v_unit_amount := coalesce(v_cfg.redeem_unit_amount,1);
    v_discount_enabled := coalesce(v_cfg.discount_enabled,false);
    v_reward_enabled := coalesce(v_cfg.reward_enabled,false);
    v_max_discount := coalesce(v_cfg.max_discount_percent,100);
    v_min_order := coalesce(v_cfg.min_order_amount,0);
  end if;

  -- 直接取目前 SC/TM 雲端最新的 yj_point_settings。
  select data::jsonb
    into v_legacy
  from public.yijia_app_state
  where data_key='yj_point_settings'
  order by updated_at desc
  limit 1;

  if v_legacy is not null then
    v_earn_amount :=
      greatest(1,coalesce(nullif(v_legacy->>'earnAmount','')::integer,1));

    v_earn_points :=
      greatest(0,coalesce(nullif(v_legacy->>'earnPoints','')::integer,1));

    v_unit_points :=
      greatest(1,coalesce(
        nullif(v_legacy->>'redeemPoints','')::integer,
        v_unit_points
      ));

    v_unit_amount :=
      greatest(0,coalesce(
        nullif(v_legacy->>'redeemAmount','')::numeric,
        v_unit_amount
      ));

    -- 只要 SC/TM 已存在合法折抵規則，就視為 App 點數折抵已開放。
    if v_unit_points>0 and v_unit_amount>0 then
      v_discount_enabled := true;
    end if;
  end if;

  v_sync := public.app_sync_my_points_from_hq();
  v_available := coalesce((v_sync->>'availablePoints')::integer,0);

  -- 同步一份到 app_point_feature_settings，讓其他既有 RPC 也吃到相同規則。
  insert into public.app_point_feature_settings(
    id,
    reward_enabled,
    discount_enabled,
    redeem_unit_points,
    redeem_unit_amount,
    max_discount_percent,
    min_order_amount,
    updated_at
  )
  values(
    'default',
    v_reward_enabled,
    v_discount_enabled,
    v_unit_points,
    v_unit_amount,
    v_max_discount,
    v_min_order,
    now()
  )
  on conflict(id) do update
  set discount_enabled=excluded.discount_enabled,
      redeem_unit_points=excluded.redeem_unit_points,
      redeem_unit_amount=excluded.redeem_unit_amount,
      max_discount_percent=excluded.max_discount_percent,
      min_order_amount=excluded.min_order_amount,
      updated_at=now();

  return jsonb_build_object(
    'rewardEnabled',v_reward_enabled,
    'discountEnabled',v_discount_enabled,
    'redeemUnitPoints',v_unit_points,
    'redeemUnitAmount',v_unit_amount,
    'maxDiscountPercent',v_max_discount,
    'minOrderAmount',v_min_order,
    'earnAmount',v_earn_amount,
    'earnPoints',v_earn_points,
    'availablePoints',v_available,
    'source','TM/SC'
  );
end;
$$;

revoke all on function public.app_get_point_feature_config() from public;
grant execute on function public.app_get_point_feature_config() to authenticated;

notify pgrst,'reload schema';

commit;

select 'POINTS_LIVE_SYNC_V0_10_9_4_READY' as result;
