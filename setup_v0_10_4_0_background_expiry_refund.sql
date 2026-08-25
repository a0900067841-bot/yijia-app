-- 億家 App v0.10.4.0
-- 隨買跨店取：背景自動逾期退款
--
-- 功能：
-- 1. 不需要會員開啟 App。
-- 2. Supabase 每小時自動檢查所有已付款隨買訂單。
-- 3. 到期未兌換剩餘價值，依購買當下價格快照計算。
-- 4. 退款一律退回「原購買人」億家錢包。
-- 5. 同一 orderId + productId/code 只處理一次。
-- 6. 轉贈只移轉剩餘數量，不改變原購買人退款歸屬。
--
-- 執行頻率：每小時第 5 分鐘
-- cron: 5 * * * *

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- ============================================================
-- 全會員背景逾期退款處理器
-- ============================================================
drop function if exists public.app_process_all_expired_anybuy_refunds();

create function public.app_process_all_expired_anybuy_refunds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_balances jsonb := '[]'::jsonb;
  v_wallet_tx jsonb := '[]'::jsonb;

  v_order jsonb;
  v_item jsonb;
  v_elem jsonb;

  v_buyer_id text;
  v_buyer_no text;
  v_buyer_phone text;
  v_buyer_name text;

  v_order_id text;
  v_product_id text;
  v_code text;
  v_item_name text;

  v_total_qty numeric;
  v_remaining_qty numeric;
  v_used_qty numeric;

  v_bundle_qty numeric;
  v_bundle_price numeric;
  v_paid_amount numeric;
  v_original_unit numeric;

  v_full_groups numeric;
  v_partial_qty numeric;
  v_partial_deduction numeric;
  v_refund_amount numeric;

  v_valid_until timestamptz;
  v_paid_at timestamptz;
  v_validity_days integer;

  v_existing jsonb;
  v_balance_row jsonb;
  v_balance numeric := 0;

  v_new_refund jsonb;
  v_new_tx jsonb;
  v_new_balances jsonb;
  v_new_products jsonb;

  v_now timestamptz := now();
  v_refund_id text;

  v_processed integer := 0;
  v_credited_total numeric := 0;
begin
  -- 共用資料列鎖定，避免背景排程與 App 手動檢查同時重複處理。
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1
  for update;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_refunds
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_expiry_refunds'
  limit 1
  for update;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_balances
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_wallet_balances'
  limit 1
  for update;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_wallet_tx
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_wallet_transactions'
  limit 1
  for update;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_pay_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_orders'
  limit 1;

  for v_order in
    select value
    from jsonb_array_elements(v_orders || v_pay_orders)
    where (
      coalesce(value->>'paymentStatus','')='paid'
      or coalesce(value->>'status','') in ('已付款','付款完成')
    )
  loop
    v_buyer_id := v_order->>'memberId';
    v_buyer_no := v_order->>'memberNo';
    v_buyer_phone := v_order->>'memberPhone';
    v_buyer_name := coalesce(v_order->>'memberName','');

    if coalesce(v_buyer_id,v_buyer_no,v_buyer_phone,'')='' then
      continue;
    end if;

    v_order_id := v_order->>'orderId';

    begin
      v_paid_at := coalesce(
        nullif(v_order->>'paidAt','')::timestamptz,
        nullif(v_order->>'createdAt','')::timestamptz
      );
    exception when others then
      v_paid_at := null;
    end;

    for v_item in
      select value
      from jsonb_array_elements(coalesce(v_order->'items','[]'::jsonb))
    loop
      v_product_id := coalesce(v_item->>'productId',v_item->>'code');
      v_code := v_item->>'code';
      v_item_name := coalesce(v_item->>'name','商品');

      select elem
      into v_existing
      from jsonb_array_elements(v_refunds) elem
      where elem->>'orderId'=v_order_id
        and (
          elem->>'productId'=v_product_id
          or (
            nullif(v_code,'') is not null
            and elem->>'code'=v_code
          )
        )
      limit 1;

      if v_existing is not null then
        continue;
      end if;

      v_validity_days := greatest(
        0,
        coalesce(nullif(v_item->>'validityDays','')::integer,0)
      );

      begin
        select max(
          case
            when nullif(elem->>'validUntil','') is not null
              then (elem->>'validUntil')::timestamptz
            else null
          end
        )
        into v_valid_until
        from jsonb_array_elements(v_products) elem
        where elem->>'orderId'=v_order_id
          and (
            elem->>'productId'=v_product_id
            or (
              nullif(v_code,'') is not null
              and elem->>'code'=v_code
            )
          );
      exception when others then
        v_valid_until := null;
      end;

      if v_valid_until is null
         and v_paid_at is not null
         and v_validity_days>0 then
        v_valid_until := v_paid_at + make_interval(days=>v_validity_days);
      end if;

      if v_valid_until is null or v_valid_until > v_now then
        continue;
      end if;

      v_bundle_qty := greatest(
        1,
        coalesce(
          nullif(v_item->>'bundleQuantity','')::numeric,
          nullif(v_item->'purchaseSnapshot'->>'bundleQuantity','')::numeric,
          1
        )
      );

      v_total_qty := greatest(
        0,
        coalesce(
          nullif(v_item->>'quantity','')::numeric,
          nullif(v_item->'purchaseSnapshot'->>'totalQuantity','')::numeric,
          v_bundle_qty *
          greatest(
            1,
            coalesce(
              nullif(v_item->>'cartQuantity','')::numeric,
              nullif(v_item->'purchaseSnapshot'->>'purchasedGroups','')::numeric,
              1
            )
          )
        )
      );

      v_bundle_price := greatest(
        0,
        coalesce(
          nullif(v_item->>'bundlePrice','')::numeric,
          nullif(v_item->>'salePrice','')::numeric,
          nullif(v_item->>'price','')::numeric,
          nullif(v_item->'purchaseSnapshot'->>'saleBundlePrice','')::numeric,
          0
        )
      );

      v_paid_amount := greatest(
        0,
        coalesce(
          nullif(v_item->>'paidAmount','')::numeric,
          nullif(v_item->'purchaseSnapshot'->>'paidAmount','')::numeric,
          v_bundle_price *
          greatest(
            1,
            coalesce(
              nullif(v_item->>'cartQuantity','')::numeric,
              nullif(v_item->'purchaseSnapshot'->>'purchasedGroups','')::numeric,
              1
            )
          )
        )
      );

      v_original_unit := greatest(
        0,
        coalesce(
          nullif(v_item->>'originalUnitPrice','')::numeric,
          nullif(v_item->'purchaseSnapshot'->>'originalUnitPrice','')::numeric,
          case
            when v_bundle_qty>0 then
              coalesce(
                nullif(v_item->>'originalBundlePrice','')::numeric,
                nullif(v_item->>'originalPrice','')::numeric,
                nullif(v_item->'purchaseSnapshot'->>'originalBundlePrice','')::numeric,
                0
              ) / v_bundle_qty
            else 0
          end
        )
      );

      select coalesce(
        sum(
          greatest(
            0,
            coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)
          )
        ),
        0
      )
      into v_remaining_qty
      from jsonb_array_elements(v_products) elem
      where elem->>'orderId'=v_order_id
        and (
          elem->>'productId'=v_product_id
          or (
            nullif(v_code,'') is not null
            and elem->>'code'=v_code
          )
        );

      v_remaining_qty :=
        least(v_total_qty,greatest(0,v_remaining_qty));

      v_used_qty := greatest(0,v_total_qty-v_remaining_qty);

      v_full_groups := floor(v_used_qty/v_bundle_qty);
      v_partial_qty := mod(v_used_qty,v_bundle_qty);

      v_partial_deduction :=
        least(v_bundle_price,v_partial_qty*v_original_unit);

      v_refund_amount :=
        greatest(
          0,
          v_paid_amount
          - (v_full_groups*v_bundle_price)
          - v_partial_deduction
        );

      v_refund_id := gen_random_uuid()::text;

      v_new_refund := jsonb_build_object(
        'id',v_refund_id,
        'type','逾期退款',
        'status','已退億家錢包',

        'memberId',v_buyer_id,
        'memberNo',v_buyer_no,
        'memberPhone',v_buyer_phone,
        'memberName',v_buyer_name,

        'orderId',v_order_id,
        'paymentCode',v_order->>'paymentCode',
        'productId',v_product_id,
        'code',v_code,
        'name',v_item_name,

        'originalQuantity',v_total_qty,
        'expiredRemainingQuantity',v_remaining_qty,
        'usedQuantity',v_used_qty,

        'bundleQuantity',v_bundle_qty,
        'bundlePrice',v_bundle_price,
        'paidAmount',v_paid_amount,
        'originalUnitPrice',v_original_unit,

        'fullUsedGroups',v_full_groups,
        'partialUsedQuantity',v_partial_qty,
        'partialUsedDeduction',v_partial_deduction,

        'refundAmount',v_refund_amount,

        'validUntil',
          to_char(
            v_valid_until at time zone 'Asia/Taipei',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || '+08:00',

        'walletCreditedAt',
          to_char(
            v_now at time zone 'Asia/Taipei',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || '+08:00',

        'createdAt',
          to_char(
            v_now at time zone 'Asia/Taipei',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || '+08:00'
      );

      v_refunds := v_refunds || jsonb_build_array(v_new_refund);

      if v_refund_amount > 0 then
        select elem
        into v_balance_row
        from jsonb_array_elements(v_balances) elem
        where (
          nullif(v_buyer_id,'') is not null
          and elem->>'memberId'=v_buyer_id
        )
        or (
          nullif(v_buyer_no,'') is not null
          and elem->>'memberNo'=v_buyer_no
        )
        or (
          nullif(v_buyer_phone,'') is not null
          and elem->>'memberPhone'=v_buyer_phone
        )
        limit 1;

        v_balance :=
          coalesce(nullif(v_balance_row->>'balance','')::numeric,0)
          + v_refund_amount;

        v_new_balances := '[]'::jsonb;

        if v_balance_row is null then
          v_balances :=
            v_balances ||
            jsonb_build_array(
              jsonb_build_object(
                'memberId',v_buyer_id,
                'memberNo',v_buyer_no,
                'memberPhone',v_buyer_phone,
                'balance',v_balance,
                'updatedAt',
                  to_char(
                    v_now at time zone 'Asia/Taipei',
                    'YYYY-MM-DD"T"HH24:MI:SS'
                  ) || '+08:00'
              )
            );
        else
          for v_elem in
            select value
            from jsonb_array_elements(v_balances)
          loop
            if (
              nullif(v_buyer_id,'') is not null
              and v_elem->>'memberId'=v_buyer_id
            )
            or (
              nullif(v_buyer_no,'') is not null
              and v_elem->>'memberNo'=v_buyer_no
            )
            or (
              nullif(v_buyer_phone,'') is not null
              and v_elem->>'memberPhone'=v_buyer_phone
            ) then
              v_elem :=
                v_elem ||
                jsonb_build_object(
                  'balance',v_balance,
                  'updatedAt',
                    to_char(
                      v_now at time zone 'Asia/Taipei',
                      'YYYY-MM-DD"T"HH24:MI:SS'
                    ) || '+08:00'
                );
            end if;

            v_new_balances :=
              v_new_balances || jsonb_build_array(v_elem);
          end loop;

          v_balances := v_new_balances;
        end if;

        v_new_tx := jsonb_build_object(
          'id',gen_random_uuid()::text,
          'type','逾期退款',
          'direction','credit',
          'amount',v_refund_amount,
          'balanceAfter',v_balance,

          'memberId',v_buyer_id,
          'memberNo',v_buyer_no,
          'memberPhone',v_buyer_phone,

          'orderId',v_order_id,
          'productId',v_product_id,
          'code',v_code,
          'name',v_item_name,
          'expiryRefundId',v_refund_id,

          'createdAt',
            to_char(
              v_now at time zone 'Asia/Taipei',
              'YYYY-MM-DD"T"HH24:MI:SS'
            ) || '+08:00'
        );

        v_wallet_tx := v_wallet_tx || jsonb_build_array(v_new_tx);
        v_credited_total := v_credited_total + v_refund_amount;
      end if;

      -- 到期後，同一原訂單 / 同商品散落在所有會員帳號的剩餘商品全部失效。
      v_new_products := '[]'::jsonb;

      for v_elem in
        select value
        from jsonb_array_elements(v_products)
      loop
        if v_elem->>'orderId'=v_order_id
           and (
             v_elem->>'productId'=v_product_id
             or (
               nullif(v_code,'') is not null
               and v_elem->>'code'=v_code
             )
           )
           and coalesce(
             nullif(v_elem->>'remainingQuantity','')::numeric,
             0
           ) > 0
        then
          v_elem :=
            v_elem ||
            jsonb_build_object(
              'status','已逾期',
              'remainingQuantity',0,
              'expiredAt',
                to_char(
                  v_now at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS'
                ) || '+08:00',
              'expiryRefundId',v_refund_id,
              'updatedAt',
                to_char(
                  v_now at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS'
                ) || '+08:00'
            );
        end if;

        v_new_products :=
          v_new_products || jsonb_build_array(v_elem);
      end loop;

      v_products := v_new_products;
      v_processed := v_processed + 1;
    end loop;
  end loop;

  if exists(
    select 1 from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_expiry_refunds'
  ) then
    update public.yijia_app_state
    set data=v_refunds,updated_at=now()
    where store_id='HQ' and data_key='yj_app_expiry_refunds';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_expiry_refunds',v_refunds,now());
  end if;

  if exists(
    select 1 from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_wallet_balances'
  ) then
    update public.yijia_app_state
    set data=v_balances,updated_at=now()
    where store_id='HQ' and data_key='yj_app_wallet_balances';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_wallet_balances',v_balances,now());
  end if;

  if exists(
    select 1 from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_wallet_transactions'
  ) then
    update public.yijia_app_state
    set data=v_wallet_tx,updated_at=now()
    where store_id='HQ' and data_key='yj_app_wallet_transactions';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_wallet_transactions',v_wallet_tx,now());
  end if;

  if exists(
    select 1 from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_member_products'
  ) then
    update public.yijia_app_state
    set data=v_products,updated_at=now()
    where store_id='HQ' and data_key='yj_app_member_products';
  end if;

  return jsonb_build_object(
    'processedCount',v_processed,
    'creditedAmount',v_credited_total,
    'ranAt',
      to_char(
        v_now at time zone 'Asia/Taipei',
        'YYYY-MM-DD"T"HH24:MI:SS'
      ) || '+08:00'
  );
end;
$$;

revoke all
on function public.app_process_all_expired_anybuy_refunds()
from public;

-- 不開放 anon / authenticated 直接呼叫背景全會員處理器。
-- pg_cron 由資料庫內部執行。
revoke execute
on function public.app_process_all_expired_anybuy_refunds()
from anon, authenticated;

-- ============================================================
-- 建立每小時背景排程
-- ============================================================

-- 若之前已有同名排程，先刪除。
do $$
declare
  v_jobid bigint;
begin
  select jobid
  into v_jobid
  from cron.job
  where jobname='yijia-anybuy-expiry-refund-hourly'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end;
$$;

select cron.schedule(
  'yijia-anybuy-expiry-refund-hourly',
  '5 * * * *',
  $$select public.app_process_all_expired_anybuy_refunds();$$
);

-- 手動驗證用：
-- select public.app_process_all_expired_anybuy_refunds();

-- 查看排程：
-- select jobid,jobname,schedule,active
-- from cron.job
-- where jobname='yijia-anybuy-expiry-refund-hourly';

-- 查看最近執行紀錄：
-- select jobid,status,return_message,start_time,end_time
-- from cron.job_run_details
-- order by start_time desc
-- limit 20;
