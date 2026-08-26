-- 億家 App v0.10.13.2 Wallet Reload Core
-- 億家Pay正式現金儲值 + 每月額度 + 錢包帳本
--
-- 正式規則：
-- - 現金儲值由門市 TM 完成，App 不自行加值
-- - 每月額度以 Asia/Taipei 曆月計算
-- - 預設上限 NT$5,000，可由總部之後接 SC 設定
-- - 同一 tm_sale_id 不可重複儲值
-- - 儲值與錢包餘額、ledger 同一 transaction

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. 億家Pay設定
-- =========================================================
create table if not exists public.app_yijiapay_settings (
  id text primary key default 'default',
  monthly_cash_reload_limit numeric(12,2) not null default 5000
    check (monthly_cash_reload_limit >= 0),
  cash_reload_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.app_yijiapay_settings(
  id,
  monthly_cash_reload_limit,
  cash_reload_enabled
)
values('default',5000,true)
on conflict(id) do nothing;

-- =========================================================
-- 2. 正式儲值紀錄
-- =========================================================
create table if not exists public.app_yijiapay_reloads (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  phone text,
  reload_type text not null default 'cash'
    check (reload_type in ('cash','other')),
  amount numeric(12,2) not null check (amount > 0),
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  store_code text,
  tm_sale_id text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_yijiapay_reloads_auth_created
  on public.app_yijiapay_reloads(auth_user_id,created_at desc);

alter table public.app_yijiapay_reloads enable row level security;

drop policy if exists app_yijiapay_reloads_read_self
on public.app_yijiapay_reloads;

create policy app_yijiapay_reloads_read_self
on public.app_yijiapay_reloads
for select
to authenticated
using (auth_user_id=auth.uid());

-- =========================================================
-- 3. TM 正式現金儲值
-- p_phone = 會員手機號碼
-- =========================================================
create or replace function public.tm_reload_yijiapay_wallet(
  p_phone text,
  p_store_code text,
  p_tm_sale_id text,
  p_amount numeric,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_uid uuid;
  v_wallet public.app_yijiapay_wallets%rowtype;
  v_amount numeric(12,2) := round(coalesce(p_amount,0)::numeric,2);
  v_limit numeric(12,2) := 5000;
  v_enabled boolean := true;
  v_used numeric(12,2) := 0;
  v_remaining numeric(12,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_existing public.app_yijiapay_reloads%rowtype;
  v_source_key text;
  v_month_start timestamptz;
  v_next_month_start timestamptz;
begin
  if v_phone='' then
    raise exception 'member phone required';
  end if;

  if trim(coalesce(p_tm_sale_id,''))='' then
    raise exception 'tm sale id required';
  end if;

  if v_amount<=0 then
    raise exception 'reload amount must be > 0';
  end if;

  select *
  into v_existing
  from public.app_yijiapay_reloads
  where tm_sale_id=trim(p_tm_sale_id)
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'reloadId',v_existing.id,
      'amount',v_existing.amount,
      'balanceBefore',v_existing.balance_before,
      'balanceAfter',v_existing.balance_after,
      'tmSaleId',v_existing.tm_sale_id,
      'createdAt',v_existing.created_at
    );
  end if;

  select auth_user_id
  into v_uid
  from public.app_members
  where regexp_replace(coalesce(phone,''),'[^0-9]','','g')=v_phone
    and auth_user_id is not null
  order by updated_at desc nulls last
  limit 1;

  if v_uid is null then
    raise exception 'member not found';
  end if;

  select
    monthly_cash_reload_limit,
    cash_reload_enabled
  into
    v_limit,
    v_enabled
  from public.app_yijiapay_settings
  where id='default';

  v_limit := coalesce(v_limit,5000);
  v_enabled := coalesce(v_enabled,true);

  if not v_enabled then
    return jsonb_build_object(
      'ok',false,
      'reason','cash_reload_disabled'
    );
  end if;

  -- 台灣本地曆月邊界，轉成 timestamptz 比較
  v_month_start :=
    (date_trunc('month',now() at time zone 'Asia/Taipei')
      at time zone 'Asia/Taipei');

  v_next_month_start :=
    ((date_trunc('month',now() at time zone 'Asia/Taipei') + interval '1 month')
      at time zone 'Asia/Taipei');

  select coalesce(sum(amount),0)
  into v_used
  from public.app_yijiapay_reloads
  where auth_user_id=v_uid
    and reload_type='cash'
    and created_at>=v_month_start
    and created_at<v_next_month_start;

  v_remaining := greatest(v_limit-v_used,0);

  if v_amount>v_remaining then
    return jsonb_build_object(
      'ok',false,
      'reason','monthly_reload_limit_exceeded',
      'monthlyLimit',v_limit,
      'usedThisMonth',v_used,
      'remainingThisMonth',v_remaining,
      'requestedAmount',v_amount
    );
  end if;

  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_uid,
    v_phone,
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone);

  select *
  into v_wallet
  from public.app_yijiapay_wallets
  where auth_user_id=v_uid
  for update;

  v_before := coalesce(v_wallet.balance,0);
  v_after := v_before+v_amount;
  v_source_key := 'RELOAD:'||trim(p_tm_sale_id);

  insert into public.app_yijiapay_wallet_ledger(
    auth_user_id,
    phone,
    entry_type,
    amount,
    balance_before,
    balance_after,
    source_type,
    source_id,
    source_key,
    store_code,
    tm_sale_id,
    description,
    created_at
  )
  values(
    v_uid,
    v_phone,
    'reload',
    v_amount,
    v_before,
    v_after,
    'cash_reload',
    trim(p_tm_sale_id),
    v_source_key,
    nullif(trim(coalesce(p_store_code,'')),''),
    trim(p_tm_sale_id),
    coalesce(nullif(trim(coalesce(p_description,'')),''),'億家Pay現金儲值'),
    now()
  );

  update public.app_yijiapay_wallets
  set balance=v_after,
      updated_at=now()
  where auth_user_id=v_uid;

  insert into public.app_yijiapay_reloads(
    auth_user_id,
    phone,
    reload_type,
    amount,
    balance_before,
    balance_after,
    store_code,
    tm_sale_id,
    description,
    created_at
  )
  values(
    v_uid,
    v_phone,
    'cash',
    v_amount,
    v_before,
    v_after,
    nullif(trim(coalesce(p_store_code,'')),''),
    trim(p_tm_sale_id),
    nullif(trim(coalesce(p_description,'')),''),
    now()
  );

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'amount',v_amount,
    'balanceBefore',v_before,
    'balanceAfter',v_after,
    'monthlyLimit',v_limit,
    'usedThisMonth',v_used+v_amount,
    'remainingThisMonth',greatest(v_limit-(v_used+v_amount),0),
    'tmSaleId',trim(p_tm_sale_id),
    'createdAt',now()
  );
end;
$$;

-- =========================================================
-- 4. App 儲值摘要 + 最近儲值
-- =========================================================
create or replace function public.app_get_my_yijiapay_reload_summary()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit numeric(12,2) := 5000;
  v_enabled boolean := true;
  v_used numeric(12,2) := 0;
  v_balance numeric(12,2) := 0;
  v_rows jsonb := '[]'::jsonb;
  v_month_start timestamptz;
  v_next_month_start timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select
    monthly_cash_reload_limit,
    cash_reload_enabled
  into
    v_limit,
    v_enabled
  from public.app_yijiapay_settings
  where id='default';

  v_limit := coalesce(v_limit,5000);
  v_enabled := coalesce(v_enabled,true);

  insert into public.app_yijiapay_wallets(
    auth_user_id,
    balance,
    updated_at
  )
  values(
    v_uid,
    0,
    now()
  )
  on conflict(auth_user_id) do nothing;

  select balance
  into v_balance
  from public.app_yijiapay_wallets
  where auth_user_id=v_uid;

  v_month_start :=
    (date_trunc('month',now() at time zone 'Asia/Taipei')
      at time zone 'Asia/Taipei');

  v_next_month_start :=
    ((date_trunc('month',now() at time zone 'Asia/Taipei') + interval '1 month')
      at time zone 'Asia/Taipei');

  select coalesce(sum(amount),0)
  into v_used
  from public.app_yijiapay_reloads
  where auth_user_id=v_uid
    and reload_type='cash'
    and created_at>=v_month_start
    and created_at<v_next_month_start;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',r.id,
        'amount',r.amount,
        'balanceBefore',r.balance_before,
        'balanceAfter',r.balance_after,
        'storeCode',r.store_code,
        'tmSaleId',r.tm_sale_id,
        'description',r.description,
        'createdAt',r.created_at
      )
      order by r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select *
    from public.app_yijiapay_reloads
    where auth_user_id=v_uid
    order by created_at desc
    limit 30
  ) r;

  return jsonb_build_object(
    'walletBalance',coalesce(v_balance,0),
    'cashReloadEnabled',v_enabled,
    'monthlyLimit',v_limit,
    'usedThisMonth',v_used,
    'remainingThisMonth',greatest(v_limit-v_used,0),
    'recentReloads',v_rows
  );
end;
$$;

-- =========================================================
-- 5. App 取得完整錢包帳本（付款 / 儲值 / 退款 / 到期退款）
-- =========================================================
create or replace function public.app_get_my_yijiapay_wallet_ledger()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',x.id,
        'entryType',x.entry_type,
        'amount',x.amount,
        'balanceBefore',x.balance_before,
        'balanceAfter',x.balance_after,
        'sourceType',x.source_type,
        'sourceId',x.source_id,
        'storeCode',x.store_code,
        'tmSaleId',x.tm_sale_id,
        'description',x.description,
        'createdAt',x.created_at
      )
      order by x.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.app_yijiapay_wallet_ledger
    where auth_user_id=v_uid
    order by created_at desc
    limit 200
  ) x;

  return v_result;
end;
$$;

-- =========================================================
-- 6. 權限
-- =========================================================
revoke all on function public.tm_reload_yijiapay_wallet(text,text,text,numeric,text) from public;
revoke all on function public.app_get_my_yijiapay_reload_summary() from public;
revoke all on function public.app_get_my_yijiapay_wallet_ledger() from public;

grant execute on function public.tm_reload_yijiapay_wallet(text,text,text,numeric,text)
to anon,authenticated;

grant execute on function public.app_get_my_yijiapay_reload_summary()
to authenticated;

grant execute on function public.app_get_my_yijiapay_wallet_ledger()
to authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_WALLET_RELOAD_CORE_V0_10_13_2_READY' as result;
