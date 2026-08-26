-- 億家 App v0.10.12.0 Pay Amount Receipt
-- 補上億家Pay門市付款金額，讓 App 完成明細 / 最近交易 / 通知可顯示實際付款金額。
-- 保留原本 3 參數 tm_complete_yijiapay_pay_code() 相容性。
-- 新版 TM 建議改呼叫 4 參數版本，把實際成交金額一起寫入。

begin;

alter table public.app_yijiapay_pay_codes
  add column if not exists amount numeric(12,2),
  add column if not exists balance_before numeric(12,2),
  add column if not exists balance_after numeric(12,2);

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
begin
  select *
  into v_row
  from public.app_yijiapay_pay_codes
  where pay_code=trim(p_pay_code)
  for update;

  if v_row.id is null then
    raise exception 'pay code not found';
  end if;

  if v_row.status='used' then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'status','used',
      'payCode',v_row.pay_code,
      'amount',v_row.amount
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

  if coalesce(p_amount,0)<0 then
    raise exception 'amount must be >= 0';
  end if;

  update public.app_yijiapay_pay_codes
  set status='used',
      amount=coalesce(p_amount,0),
      used_at=now(),
      used_store_code=nullif(trim(coalesce(p_store_code,'')),''),
      tm_sale_id=nullif(trim(coalesce(p_sale_id,'')),'')
  where id=v_row.id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'status','used',
    'payCode',v_row.pay_code,
    'amount',coalesce(p_amount,0)
  );
end;
$$;

-- 舊 TM 相容：若還在呼叫 3 參數，仍可完成，但 amount 會是 null。
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
  return public.tm_complete_yijiapay_pay_code(
    p_pay_code,
    p_store_code,
    p_sale_id,
    null::numeric
  );
end;
$$;

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
        'balanceBefore',t.balance_before,
        'balanceAfter',t.balance_after,
        'usedAt',t.used_at,
        'usedStoreCode',t.used_store_code,
        'tmSaleId',t.tm_sale_id,
        'createdAt',t.created_at
      )
      order by t.used_at desc nulls last, t.created_at desc
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
    limit 30
  ) t;

  return v_result;
end;
$$;

revoke all on function public.tm_complete_yijiapay_pay_code(text,text,text,numeric) from public;
revoke all on function public.tm_complete_yijiapay_pay_code(text,text,text) from public;
revoke all on function public.app_get_yijiapay_pay_code_status(text) from public;
revoke all on function public.app_get_my_yijiapay_pay_history() from public;

grant execute on function public.tm_complete_yijiapay_pay_code(text,text,text,numeric)
to anon,authenticated;

grant execute on function public.tm_complete_yijiapay_pay_code(text,text,text)
to anon,authenticated;

grant execute on function public.app_get_yijiapay_pay_code_status(text)
to authenticated;

grant execute on function public.app_get_my_yijiapay_pay_history()
to authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_PAY_AMOUNT_RECEIPT_V0_10_12_0_READY' as result;
