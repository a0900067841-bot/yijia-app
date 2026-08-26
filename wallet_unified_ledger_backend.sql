-- 億家 App v0.10.13.3 Wallet Unified Ledger
-- 統一億家Pay錢包帳本：
-- payment / reload / refund / expiry_refund / adjustment

begin;

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
      and entry_type in (
        'payment',
        'reload',
        'refund',
        'expiry_refund',
        'adjustment'
      )
    order by created_at desc
    limit 500
  ) x;

  return v_result;
end;
$$;

revoke all
on function public.app_get_my_yijiapay_wallet_ledger()
from public;

grant execute
on function public.app_get_my_yijiapay_wallet_ledger()
to authenticated;

notify pgrst,'reload schema';

commit;

select
  'YIJIAPAY_WALLET_UNIFIED_LEDGER_V0_10_13_3_READY'
  as result;
