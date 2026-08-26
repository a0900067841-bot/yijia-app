-- 億家 App v0.10.13.0 Wallet Debit Core
-- 億家Pay正式錢包扣款核心
--
-- 目標：
-- 1. 一位會員一個正式錢包餘額
-- 2. TM 掃 App 60 秒付款碼後，交易成功時原子扣款
-- 3. 餘額不足 -> 不扣款
-- 4. 重複完成同一付款碼 -> 不重複扣款
-- 5. 任何錯誤 -> 整筆交易 rollback
-- 6. 每次扣款寫正式 wallet ledger
-- 7. App 可讀付款前/後餘額

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. 正式錢包
-- =========================================================
create table if not exists public.app_yijiapay_wallets (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  balance numeric(12,2) not null default 0
    check (balance >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_yijiapay_wallets_phone
  on public.app_yijiapay_wallets(phone);

alter table public.app_yijiapay_wallets enable row level security;

drop policy if exists app_yijiapay_wallets_read_self
on public.app_yijiapay_wallets;

create policy app_yijiapay_wallets_read_self
on public.app_yijiapay_wallets
for select
to authenticated
using (auth_user_id = auth.uid());


-- =========================================================
-- 2. 正式錢包帳本
-- amount:
--   正數 = 入帳
--   負數 = 扣款
-- source_key 保證同一來源不重複入帳/扣款
-- =========================================================
create table if not exists public.app_yijiapay_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  phone text,
  entry_type text not null
    check (entry_type in (
      'reload',
      'payment',
      'refund',
      'expiry_refund',
      'adjustment'
    )),
  amount numeric(12,2) not null,
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  source_type text,
  source_id text,
  source_key text unique,
  store_code text,
  tm_sale_id text,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_yijiapay_wallet_ledger_auth_created
  on public.app_yijiapay_wallet_ledger(auth_user_id,created_at desc);

create index if not exists idx_app_yijiapay_wallet_ledger_sale
  on public.app_yijiapay_wallet_ledger(tm_sale_id);

alter table public.app_yijiapay_wallet_ledger enable row level security;

drop policy if exists app_yijiapay_wallet_ledger_read_self
on public.app_yijiapay_wallet_ledger;

create policy app_yijiapay_wallet_ledger_read_self
on public.app_yijiapay_wallet_ledger
for select
to authenticated
using (auth_user_id = auth.uid());


-- =========================================================
-- 3. 自動建立目前會員錢包
-- =========================================================
create or replace function public.app_ensure_my_yijiapay_wallet()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_balance numeric(12,2);
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

  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_uid,
    nullif(v_phone,''),
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone),
    updated_at=now();

  select balance
  into v_balance
  from public.app_yijiapay_wallets
  where auth_user_id=v_uid;

  return jsonb_build_object(
    'ok',true,
    'walletBalance',coalesce(v_balance,0)
  );
end;
$$;


-- =========================================================
-- 4. App 正式錢包餘額
-- 保留既有前端呼叫名稱
-- =========================================================
create or replace function public.app_get_yijiapay_wallet_balance()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_balance numeric(12,2);
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

  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_uid,
    nullif(v_phone,''),
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone);

  select balance
  into v_balance
  from public.app_yijiapay_wallets
  where auth_user_id=v_uid;

  return jsonb_build_object(
    'walletBalance',coalesce(v_balance,0),
    'balance',coalesce(v_balance,0)
  );
end;
$$;


-- =========================================================
-- 5. TM 讀付款碼
-- 增加即時錢包餘額資訊
-- 這一步只讀，不扣款
-- =========================================================
create or replace function public.tm_get_yijiapay_pay_code(
  p_pay_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.app_yijiapay_pay_codes%rowtype;
  v_balance numeric(12,2) := 0;
begin
  select *
  into v_row
  from public.app_yijiapay_pay_codes
  where pay_code=trim(p_pay_code)
  limit 1;

  if v_row.id is null then
    return jsonb_build_object(
      'ok',false,
      'reason','not_found'
    );
  end if;

  if v_row.status='pending'
     and v_row.expires_at<=now() then
    update public.app_yijiapay_pay_codes
    set status='expired'
    where id=v_row.id;

    return jsonb_build_object(
      'ok',false,
      'reason','expired',
      'status','expired'
    );
  end if;

  if v_row.status<>'pending' then
    return jsonb_build_object(
      'ok',false,
      'reason',v_row.status,
      'status',v_row.status
    );
  end if;

  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_row.auth_user_id,
    v_row.member_phone,
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone);

  select balance
  into v_balance
  from public.app_yijiapay_wallets
  where auth_user_id=v_row.auth_user_id;

  return jsonb_build_object(
    'ok',true,
    'payCode',v_row.pay_code,
    'status',v_row.status,
    'memberPhone',v_row.member_phone,
    'memberNo',v_row.member_no,
    'authUserId',v_row.auth_user_id,
    'expiresAt',v_row.expires_at,
    'walletBalance',coalesce(v_balance,0)
  );
end;
$$;


-- =========================================================
-- 6. 正式 TM 原子扣款
--
-- 呼叫方式：
-- tm_complete_yijiapay_pay_code(
--   pay_code,
--   store_code,
--   sale_id,
--   amount
-- )
--
-- 安全：
-- - 鎖付款碼
-- - 鎖會員錢包
-- - 驗證期限
-- - 驗證餘額
-- - 寫 ledger
-- - 扣款
-- - 標記 pay code used
-- 全部在同一 DB transaction
-- =========================================================
create or replace function public.tm_complete_yijiapay_pay_code(
  p_pay_code text,
  p_store_code text,
  p_sale_id text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.app_yijiapay_pay_codes%rowtype;
  v_wallet public.app_yijiapay_wallets%rowtype;
  v_amount numeric(12,2) := round(coalesce(p_amount,0)::numeric,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_source_key text;
begin
  if trim(coalesce(p_pay_code,''))='' then
    raise exception 'pay code required';
  end if;

  if trim(coalesce(p_sale_id,''))='' then
    raise exception 'sale id required';
  end if;

  if v_amount<=0 then
    raise exception 'amount must be > 0';
  end if;

  -- 鎖定付款碼，避免兩台 TM 同時完成同一張。
  select *
  into v_row
  from public.app_yijiapay_pay_codes
  where pay_code=trim(p_pay_code)
  for update;

  if v_row.id is null then
    raise exception 'pay code not found';
  end if;

  -- Idempotent：若已完成，直接回原結果，不再扣一次。
  if v_row.status='used' then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'status','used',
      'payCode',v_row.pay_code,
      'amount',v_row.amount,
      'balanceBefore',v_row.balance_before,
      'balanceAfter',v_row.balance_after,
      'usedAt',v_row.used_at,
      'usedStoreCode',v_row.used_store_code,
      'tmSaleId',v_row.tm_sale_id
    );
  end if;

  if v_row.status<>'pending' then
    raise exception 'pay code is %',v_row.status;
  end if;

  if v_row.expires_at<=now() then
    update public.app_yijiapay_pay_codes
    set status='expired'
    where id=v_row.id;

    raise exception 'pay code expired';
  end if;

  -- 建立 / 鎖定會員錢包。
  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_row.auth_user_id,
    v_row.member_phone,
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone);

  select *
  into v_wallet
  from public.app_yijiapay_wallets
  where auth_user_id=v_row.auth_user_id
  for update;

  v_before := coalesce(v_wallet.balance,0);

  if v_before < v_amount then
    return jsonb_build_object(
      'ok',false,
      'reason','insufficient_balance',
      'status','pending',
      'payCode',v_row.pay_code,
      'amount',v_amount,
      'walletBalance',v_before,
      'shortage',v_amount-v_before
    );
  end if;

  v_after := v_before-v_amount;
  v_source_key := 'PAY:'||v_row.id::text;

  -- source_key unique = 最後一道防重複扣款保護。
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
    v_row.auth_user_id,
    v_row.member_phone,
    'payment',
    -v_amount,
    v_before,
    v_after,
    'pay_code',
    v_row.id::text,
    v_source_key,
    nullif(trim(coalesce(p_store_code,'')),''),
    trim(p_sale_id),
    '億家Pay門市付款',
    now()
  );

  update public.app_yijiapay_wallets
  set balance=v_after,
      updated_at=now()
  where auth_user_id=v_row.auth_user_id;

  update public.app_yijiapay_pay_codes
  set status='used',
      amount=v_amount,
      balance_before=v_before,
      balance_after=v_after,
      used_at=now(),
      used_store_code=nullif(trim(coalesce(p_store_code,'')),''),
      tm_sale_id=trim(p_sale_id)
  where id=v_row.id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'status','used',
    'payCode',v_row.pay_code,
    'amount',v_amount,
    'balanceBefore',v_before,
    'balanceAfter',v_after,
    'usedAt',now(),
    'usedStoreCode',nullif(trim(coalesce(p_store_code,'')),''),
    'tmSaleId',trim(p_sale_id)
  );
end;
$$;


-- =========================================================
-- 7. 舊三參數完成函式保留，但正式扣款必須帶金額
-- 不再允許用舊函式默默完成 0 元付款。
-- =========================================================
create or replace function public.tm_complete_yijiapay_pay_code(
  p_pay_code text,
  p_store_code text,
  p_sale_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  return jsonb_build_object(
    'ok',false,
    'reason','amount_required',
    'message','請使用四參數 tm_complete_yijiapay_pay_code(pay_code,store_code,sale_id,amount)'
  );
end;
$$;


-- =========================================================
-- 8. App 付款碼狀態（含扣款前後餘額）
-- =========================================================
create or replace function public.app_get_yijiapay_pay_code_status(
  p_pay_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.app_yijiapay_pay_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select *
  into v_row
  from public.app_yijiapay_pay_codes
  where auth_user_id=v_uid
    and pay_code=trim(p_pay_code)
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('found',false);
  end if;

  if v_row.status='pending' and v_row.expires_at<=now() then
    update public.app_yijiapay_pay_codes
    set status='expired'
    where id=v_row.id;

    v_row.status := 'expired';
  end if;

  return jsonb_build_object(
    'found',true,
    'payCode',v_row.pay_code,
    'status',v_row.status,
    'amount',v_row.amount,
    'balanceBefore',v_row.balance_before,
    'balanceAfter',v_row.balance_after,
    'expiresAt',v_row.expires_at,
    'usedAt',v_row.used_at,
    'usedStoreCode',v_row.used_store_code,
    'tmSaleId',v_row.tm_sale_id
  );
end;
$$;


-- =========================================================
-- 9. App 正式錢包帳本
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
    limit 100
  ) x;

  return v_result;
end;
$$;


-- =========================================================
-- 10. 權限
-- =========================================================
revoke all on function public.app_ensure_my_yijiapay_wallet() from public;
revoke all on function public.app_get_yijiapay_wallet_balance() from public;
revoke all on function public.app_get_my_yijiapay_wallet_ledger() from public;
revoke all on function public.app_get_yijiapay_pay_code_status(text) from public;
revoke all on function public.tm_get_yijiapay_pay_code(text) from public;
revoke all on function public.tm_complete_yijiapay_pay_code(text,text,text,numeric) from public;
revoke all on function public.tm_complete_yijiapay_pay_code(text,text,text) from public;

grant execute on function public.app_ensure_my_yijiapay_wallet()
to authenticated;

grant execute on function public.app_get_yijiapay_wallet_balance()
to authenticated;

grant execute on function public.app_get_my_yijiapay_wallet_ledger()
to authenticated;

grant execute on function public.app_get_yijiapay_pay_code_status(text)
to authenticated;

grant execute on function public.tm_get_yijiapay_pay_code(text)
to anon,authenticated;

grant execute on function public.tm_complete_yijiapay_pay_code(text,text,text,numeric)
to anon,authenticated;

grant execute on function public.tm_complete_yijiapay_pay_code(text,text,text)
to anon,authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_WALLET_DEBIT_CORE_V0_10_13_0_READY' as result;
