-- 億家 App v0.10.13.1 Wallet Refund Core
-- 億家Pay 正式退款回錢包核心
--
-- 支援：
-- 1. 原付款交易全額退款
-- 2. 部分退款
-- 3. 多次部分退款，但累計不得超過原付款金額
-- 4. 同一 refund_sale_id 不重複退款
-- 5. 退款與錢包入帳、refund record、ledger 全部原子交易
-- 6. App 可讀已退款金額與剩餘可退款金額

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. 原付款交易補退款累計欄位
-- =========================================================
alter table public.app_yijiapay_pay_codes
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists last_refunded_at timestamptz;

-- =========================================================
-- 2. 正式退款紀錄
-- =========================================================
create table if not exists public.app_yijiapay_refunds (
  id uuid primary key default gen_random_uuid(),
  pay_code_id uuid not null references public.app_yijiapay_pay_codes(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  pay_code text not null,
  original_tm_sale_id text,
  refund_sale_id text not null,
  refund_amount numeric(12,2) not null check (refund_amount > 0),
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  store_code text,
  reason text,
  created_at timestamptz not null default now(),
  unique(refund_sale_id)
);

create index if not exists idx_app_yijiapay_refunds_auth_created
  on public.app_yijiapay_refunds(auth_user_id,created_at desc);

create index if not exists idx_app_yijiapay_refunds_pay_code
  on public.app_yijiapay_refunds(pay_code_id);

alter table public.app_yijiapay_refunds enable row level security;

drop policy if exists app_yijiapay_refunds_read_self
on public.app_yijiapay_refunds;

create policy app_yijiapay_refunds_read_self
on public.app_yijiapay_refunds
for select
to authenticated
using (auth_user_id=auth.uid());

-- =========================================================
-- 3. TM 正式退款 RPC
--
-- p_amount:
--   NULL 或 <=0 -> 全退目前剩餘可退款金額
--   >0         -> 部分退款
-- =========================================================
create or replace function public.tm_refund_yijiapay_payment(
  p_pay_code text,
  p_store_code text,
  p_refund_sale_id text,
  p_amount numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_pay public.app_yijiapay_pay_codes%rowtype;
  v_wallet public.app_yijiapay_wallets%rowtype;
  v_paid numeric(12,2);
  v_refunded numeric(12,2);
  v_refundable numeric(12,2);
  v_refund numeric(12,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_source_key text;
  v_existing public.app_yijiapay_refunds%rowtype;
begin
  if trim(coalesce(p_pay_code,''))='' then
    raise exception 'pay code required';
  end if;

  if trim(coalesce(p_refund_sale_id,''))='' then
    raise exception 'refund sale id required';
  end if;

  -- Idempotent by refund_sale_id
  select *
  into v_existing
  from public.app_yijiapay_refunds
  where refund_sale_id=trim(p_refund_sale_id)
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'refundId',v_existing.id,
      'payCode',v_existing.pay_code,
      'refundSaleId',v_existing.refund_sale_id,
      'refundAmount',v_existing.refund_amount,
      'balanceBefore',v_existing.balance_before,
      'balanceAfter',v_existing.balance_after,
      'createdAt',v_existing.created_at
    );
  end if;

  -- Lock original payment
  select *
  into v_pay
  from public.app_yijiapay_pay_codes
  where pay_code=trim(p_pay_code)
  for update;

  if v_pay.id is null then
    raise exception 'pay code not found';
  end if;

  if v_pay.status<>'used' then
    raise exception 'payment is not completed';
  end if;

  v_paid := coalesce(v_pay.amount,0);
  v_refunded := coalesce(v_pay.refunded_amount,0);
  v_refundable := greatest(v_paid-v_refunded,0);

  if v_refundable<=0 then
    return jsonb_build_object(
      'ok',false,
      'reason','already_fully_refunded',
      'payCode',v_pay.pay_code,
      'paidAmount',v_paid,
      'refundedAmount',v_refunded,
      'refundableAmount',0
    );
  end if;

  v_refund := round(
    case
      when p_amount is null or p_amount<=0 then v_refundable
      else p_amount
    end::numeric,
    2
  );

  if v_refund<=0 then
    raise exception 'refund amount must be > 0';
  end if;

  if v_refund>v_refundable then
    return jsonb_build_object(
      'ok',false,
      'reason','refund_exceeds_remaining',
      'payCode',v_pay.pay_code,
      'requestedAmount',v_refund,
      'paidAmount',v_paid,
      'refundedAmount',v_refunded,
      'refundableAmount',v_refundable
    );
  end if;

  -- Lock wallet
  insert into public.app_yijiapay_wallets(
    auth_user_id,
    phone,
    balance,
    updated_at
  )
  values(
    v_pay.auth_user_id,
    v_pay.member_phone,
    0,
    now()
  )
  on conflict(auth_user_id)
  do update set
    phone=coalesce(excluded.phone,public.app_yijiapay_wallets.phone);

  select *
  into v_wallet
  from public.app_yijiapay_wallets
  where auth_user_id=v_pay.auth_user_id
  for update;

  v_before := coalesce(v_wallet.balance,0);
  v_after := v_before+v_refund;
  v_source_key := 'REFUND:'||trim(p_refund_sale_id);

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
    v_pay.auth_user_id,
    v_pay.member_phone,
    'refund',
    v_refund,
    v_before,
    v_after,
    'pay_refund',
    v_pay.id::text,
    v_source_key,
    nullif(trim(coalesce(p_store_code,'')),''),
    trim(p_refund_sale_id),
    coalesce(nullif(trim(coalesce(p_reason,'')),''),'億家Pay付款退款'),
    now()
  );

  update public.app_yijiapay_wallets
  set balance=v_after,
      updated_at=now()
  where auth_user_id=v_pay.auth_user_id;

  insert into public.app_yijiapay_refunds(
    pay_code_id,
    auth_user_id,
    pay_code,
    original_tm_sale_id,
    refund_sale_id,
    refund_amount,
    balance_before,
    balance_after,
    store_code,
    reason,
    created_at
  )
  values(
    v_pay.id,
    v_pay.auth_user_id,
    v_pay.pay_code,
    v_pay.tm_sale_id,
    trim(p_refund_sale_id),
    v_refund,
    v_before,
    v_after,
    nullif(trim(coalesce(p_store_code,'')),''),
    nullif(trim(coalesce(p_reason,'')),''),
    now()
  );

  update public.app_yijiapay_pay_codes
  set refunded_amount=coalesce(refunded_amount,0)+v_refund,
      last_refunded_at=now()
  where id=v_pay.id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'payCode',v_pay.pay_code,
    'originalTmSaleId',v_pay.tm_sale_id,
    'refundSaleId',trim(p_refund_sale_id),
    'refundAmount',v_refund,
    'paidAmount',v_paid,
    'refundedAmount',v_refunded+v_refund,
    'refundableAmount',greatest(v_paid-(v_refunded+v_refund),0),
    'balanceBefore',v_before,
    'balanceAfter',v_after,
    'createdAt',now()
  );
end;
$$;

-- =========================================================
-- 4. App 付款狀態補退款資訊
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
  v_refundable numeric(12,2);
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

  v_refundable := greatest(
    coalesce(v_row.amount,0)-coalesce(v_row.refunded_amount,0),
    0
  );

  return jsonb_build_object(
    'found',true,
    'payCode',v_row.pay_code,
    'status',v_row.status,
    'amount',v_row.amount,
    'refundedAmount',coalesce(v_row.refunded_amount,0),
    'refundableAmount',v_refundable,
    'lastRefundedAt',v_row.last_refunded_at,
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
-- 5. App 最近付款紀錄補退款資訊
-- =========================================================
create or replace function public.app_get_my_yijiapay_pay_history()
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
        'payCode',t.pay_code,
        'status',t.status,
        'amount',t.amount,
        'refundedAmount',coalesce(t.refunded_amount,0),
        'refundableAmount',
          greatest(coalesce(t.amount,0)-coalesce(t.refunded_amount,0),0),
        'lastRefundedAt',t.last_refunded_at,
        'balanceBefore',t.balance_before,
        'balanceAfter',t.balance_after,
        'usedAt',t.used_at,
        'usedStoreCode',t.used_store_code,
        'tmSaleId',t.tm_sale_id,
        'createdAt',t.created_at
      )
      order by t.used_at desc nulls last,t.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.app_yijiapay_pay_codes
    where auth_user_id=v_uid
      and status='used'
    order by used_at desc nulls last,created_at desc
    limit 100
  ) t;

  return v_result;
end;
$$;

-- =========================================================
-- 6. App 正式退款紀錄
-- =========================================================
create or replace function public.app_get_my_yijiapay_refunds()
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
        'id',r.id,
        'payCode',r.pay_code,
        'originalTmSaleId',r.original_tm_sale_id,
        'refundSaleId',r.refund_sale_id,
        'refundAmount',r.refund_amount,
        'balanceBefore',r.balance_before,
        'balanceAfter',r.balance_after,
        'storeCode',r.store_code,
        'reason',r.reason,
        'createdAt',r.created_at
      )
      order by r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.app_yijiapay_refunds
    where auth_user_id=v_uid
    order by created_at desc
    limit 100
  ) r;

  return v_result;
end;
$$;

-- =========================================================
-- 7. 權限
-- =========================================================
revoke all on function public.tm_refund_yijiapay_payment(text,text,text,numeric,text) from public;
revoke all on function public.app_get_yijiapay_pay_code_status(text) from public;
revoke all on function public.app_get_my_yijiapay_pay_history() from public;
revoke all on function public.app_get_my_yijiapay_refunds() from public;

grant execute on function public.tm_refund_yijiapay_payment(text,text,text,numeric,text)
to anon,authenticated;

grant execute on function public.app_get_yijiapay_pay_code_status(text)
to authenticated;

grant execute on function public.app_get_my_yijiapay_pay_history()
to authenticated;

grant execute on function public.app_get_my_yijiapay_refunds()
to authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_WALLET_REFUND_CORE_V0_10_13_1_READY' as result;
