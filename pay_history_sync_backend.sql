-- 億家 App v0.10.11.8 Pay History Sync
-- 讀取會員自己的億家Pay付款碼完成紀錄。

begin;

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
    order by used_at desc nulls last, created_at desc
    limit 30
  ) t;

  return v_result;
end;
$$;

revoke all
on function public.app_get_my_yijiapay_pay_history()
from public;

grant execute
on function public.app_get_my_yijiapay_pay_history()
to authenticated;

notify pgrst,'reload schema';

commit;

select 'YIJIAPAY_PAY_HISTORY_V0_10_11_8_READY' as result;
