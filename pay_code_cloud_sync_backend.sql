-- 億家 App v0.10.11.6 Pay Code Cloud Sync
-- 付款條碼 / QR Code 改為 60 秒有效的雲端付款 Token。
-- App 只負責產生與顯示；TM 可讀取有效付款碼並在交易完成後標記 used。

begin;

create extension if not exists pgcrypto;

create table if not exists public.app_yijiapay_pay_codes (
  id uuid primary key default gen_random_uuid(),
  pay_code text not null unique,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  member_phone text,
  member_no text,
  status text not null default 'pending'
    check (status in ('pending','used','expired','cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_store_code text,
  tm_sale_id text
);

create index if not exists idx_app_yijiapay_pay_codes_auth_created
  on public.app_yijiapay_pay_codes(auth_user_id,created_at desc);

create index if not exists idx_app_yijiapay_pay_codes_status_expiry
  on public.app_yijiapay_pay_codes(status,expires_at);

alter table public.app_yijiapay_pay_codes enable row level security;

drop policy if exists app_yijiapay_pay_codes_read_self
on public.app_yijiapay_pay_codes;

create policy app_yijiapay_pay_codes_read_self
on public.app_yijiapay_pay_codes
for select
to authenticated
using (auth_user_id=auth.uid());


create or replace function public.app_create_yijiapay_pay_code()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_member_no text := '';
  v_code text;
  v_expires timestamptz := now() + interval '60 seconds';
  v_member jsonb := '{}'::jsonb;
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

  begin
    v_member := public.app_current_member_json();
  exception when others then
    v_member := '{}'::jsonb;
  end;

  v_member_no := trim(coalesce(
    v_member->>'memberNo',
    v_member->>'member_no',
    ''
  ));

  -- 同會員舊的 pending 付款碼直接取消，確保同一時間只有一張有效。
  update public.app_yijiapay_pay_codes
  set status='cancelled'
  where auth_user_id=v_uid
    and status='pending';

  -- YP + 18 位十六進位大寫字元，避免把手機號碼直接放進付款碼。
  v_code := 'YP' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,18));

  insert into public.app_yijiapay_pay_codes(
    pay_code,
    auth_user_id,
    member_phone,
    member_no,
    status,
    expires_at,
    created_at
  )
  values(
    v_code,
    v_uid,
    nullif(v_phone,''),
    nullif(v_member_no,''),
    'pending',
    v_expires,
    now()
  );

  return jsonb_build_object(
    'ok',true,
    'payCode',v_code,
    'expiresAt',v_expires,
    'validSeconds',60
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
    'expiresAt',v_row.expires_at,
    'usedAt',v_row.used_at,
    'usedStoreCode',v_row.used_store_code,
    'tmSaleId',v_row.tm_sale_id
  );
end;
$$;


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

  if v_row.status='pending' and v_row.expires_at<=now() then
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

  return jsonb_build_object(
    'ok',true,
    'payCode',v_row.pay_code,
    'status',v_row.status,
    'memberPhone',v_row.member_phone,
    'memberNo',v_row.member_no,
    'authUserId',v_row.auth_user_id,
    'expiresAt',v_row.expires_at
  );
end;
$$;


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
      'payCode',v_row.pay_code
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

  update public.app_yijiapay_pay_codes
  set status='used',
      used_at=now(),
      used_store_code=nullif(trim(coalesce(p_store_code,'')),''),
      tm_sale_id=nullif(trim(coalesce(p_sale_id,'')),'')
  where id=v_row.id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'status','used',
    'payCode',v_row.pay_code
  );
end;
$$;


revoke all on function public.app_create_yijiapay_pay_code() from public;
revoke all on function public.app_get_yijiapay_pay_code_status(text) from public;
revoke all on function public.tm_get_yijiapay_pay_code(text) from public;
revoke all on function public.tm_complete_yijiapay_pay_code(text,text,text) from public;

grant execute on function public.app_create_yijiapay_pay_code()
to authenticated;

grant execute on function public.app_get_yijiapay_pay_code_status(text)
to authenticated;

grant execute on function public.tm_get_yijiapay_pay_code(text)
to anon,authenticated;

grant execute on function public.tm_complete_yijiapay_pay_code(text,text,text)
to anon,authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_PAY_CODE_CLOUD_SYNC_V0_10_11_6_READY' as result;
