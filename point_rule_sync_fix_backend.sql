-- 億家 App v0.10.10.3 Point Rule Sync Fix
-- 修正「點數餘額已同步，但點數規則顯示同步失敗」。
-- 直接從既有 TM / SC yj_point_settings 讀取規則，
-- 並以 app_point_feature_settings 作為正式 App 功能開關/備援值。

begin;

create or replace function public.app_get_point_feature_config()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.app_point_feature_settings%rowtype;
  v_raw jsonb := '{}'::jsonb;
  v_settings jsonb := '{}'::jsonb;

  v_available integer := 0;

  v_earn_amount integer := 1;
  v_earn_points integer := 1;

  v_redeem_points integer := 300;
  v_redeem_amount numeric(12,2) := 1;

  v_reward_enabled boolean := false;
  v_discount_enabled boolean := false;

  v_max_discount numeric(5,2) := 100;
  v_min_order numeric(12,2) := 0;

  v_text text;
  v_source text := 'App 備援設定';
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- 目前 App 點數餘額：沿用已經同步成功的 app_points。
  select coalesce(available_points,0)
    into v_available
  from public.app_points
  where auth_user_id=v_uid
  limit 1;

  -- App 點數功能開關／備援規則。
  select *
    into v_cfg
  from public.app_point_feature_settings
  where id='default'
  limit 1;

  if found then
    v_reward_enabled := coalesce(v_cfg.reward_enabled,false);
    v_discount_enabled := coalesce(v_cfg.discount_enabled,false);
    v_redeem_points := greatest(1,coalesce(v_cfg.redeem_unit_points,300));
    v_redeem_amount := greatest(0,coalesce(v_cfg.redeem_unit_amount,1));
    v_max_discount := coalesce(v_cfg.max_discount_percent,100);
    v_min_order := coalesce(v_cfg.min_order_amount,0);
  end if;

  -- TM / SC 既有會員累點／折抵設定。
  -- 優先取 HQ；若舊資料不是 HQ，再取最新一筆。
  select data::jsonb
    into v_raw
  from public.yijia_app_state
  where data_key='yj_point_settings'
  order by
    case when store_id='HQ' then 0
         when store_id='001' then 1
         else 2 end,
    updated_at desc
  limit 1;

  if v_raw is not null then
    -- 相容直接物件、settings、pointSettings 三種包裝。
    if jsonb_typeof(v_raw->'pointSettings')='object' then
      v_settings := v_raw->'pointSettings';
    elsif jsonb_typeof(v_raw->'settings')='object' then
      v_settings := v_raw->'settings';
    else
      v_settings := v_raw;
    end if;

    -- earnAmount
    v_text := trim(coalesce(v_settings->>'earnAmount',''));
    if v_text ~ '^[0-9]+$' then
      v_earn_amount := greatest(1,v_text::integer);
    end if;

    -- earnPoints
    v_text := trim(coalesce(v_settings->>'earnPoints',''));
    if v_text ~ '^[0-9]+$' then
      v_earn_points := greatest(0,v_text::integer);
    end if;

    -- redeemPoints
    v_text := trim(coalesce(v_settings->>'redeemPoints',''));
    if v_text ~ '^[0-9]+$' then
      v_redeem_points := greatest(1,v_text::integer);
    end if;

    -- redeemAmount
    v_text := trim(coalesce(v_settings->>'redeemAmount',''));
    if v_text ~ '^[0-9]+([.][0-9]+)?$' then
      v_redeem_amount := greatest(0,v_text::numeric);
    end if;

    -- 只要既有 TM / SC 有合法折抵規則，就讓 App 折抵入口使用同一規則。
    if v_redeem_points>0 and v_redeem_amount>0 then
      v_discount_enabled := true;
    end if;

    v_source := 'TM／SC';
  end if;

  -- 將最新比例同步回 App 設定表，讓其他既有 RPC 也吃相同值。
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
    v_redeem_points,
    v_redeem_amount,
    v_max_discount,
    v_min_order,
    now()
  )
  on conflict(id) do update
  set reward_enabled=excluded.reward_enabled,
      discount_enabled=excluded.discount_enabled,
      redeem_unit_points=excluded.redeem_unit_points,
      redeem_unit_amount=excluded.redeem_unit_amount,
      max_discount_percent=excluded.max_discount_percent,
      min_order_amount=excluded.min_order_amount,
      updated_at=now();

  return jsonb_build_object(
    'rewardEnabled',v_reward_enabled,
    'discountEnabled',v_discount_enabled,
    'earnAmount',v_earn_amount,
    'earnPoints',v_earn_points,
    'redeemUnitPoints',v_redeem_points,
    'redeemUnitAmount',v_redeem_amount,
    'maxDiscountPercent',v_max_discount,
    'minOrderAmount',v_min_order,
    'availablePoints',coalesce(v_available,0),
    'settingsSource',v_source
  );
end;
$$;

revoke all on function public.app_get_point_feature_config() from public;
grant execute on function public.app_get_point_feature_config() to authenticated;

notify pgrst,'reload schema';

commit;

select 'POINT_RULE_SYNC_V0_10_10_3_READY' as result;
