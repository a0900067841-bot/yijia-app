-- 億家 App v0.10.3.0
-- 隨買跨店取：逾期未兌換商品退款至「原購買人」億家錢包
--
-- 本版採「App 開啟 / 讀取億家Pay時自動檢查」：
-- 會員一登入或開啟億家Pay，系統會處理該會員作為「原購買人」的到期訂單。
--
-- 重要規則：
-- 1. 退款永遠歸原購買人，不歸目前商品持有人。
-- 2. 商品轉贈本身不會讓逾期退款消失；如果收禮人到期仍未兌換，
--    那些未兌換數量仍會納入原購買人的逾期退款。
-- 3. 因此逾期時計算「實際已使用數量」時，用：
--      原購買總數量 - 同訂單/同商品在所有會員手上的剩餘總數量
--    轉贈只是在會員之間移轉 remainingQuantity，總剩餘不會因轉贈而減少。
-- 4. 退款公式：
--    付款金額
--    -（已使用完整組數 × 購買當時每組實付金額）
--    - min（未滿一組已使用數量 × 購買當時單個原價，購買當時每組實付金額）
--    最低為 0。
-- 5. 已退款後同一 orderId + productId 不會重複退款。
--
-- 新增共用 state key：
-- HQ / yj_app_wallet_balances
-- HQ / yj_app_wallet_transactions
-- HQ / yj_app_expiry_refunds

create extension if not exists pgcrypto;

-- ============================================================
-- 讀取目前會員的億家錢包餘額
-- ============================================================
drop function if exists public.app_get_yijiapay_wallet_balance();

create function public.app_get_yijiapay_wallet_balance()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_member_no text;
  v_balances jsonb := '[]'::jsonb;
  v_row jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone
  into v_phone
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;

  v_member_no := 'YJ' || v_phone;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_balances
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_wallet_balances'
  limit 1;

  select elem
  into v_row
  from jsonb_array_elements(coalesce(v_balances,'[]'::jsonb)) elem
  where elem->>'memberId'=v_uid::text
     or elem->>'memberNo'=v_member_no
     or elem->>'memberPhone'=v_phone
  limit 1;

  return jsonb_build_object(
    'walletBalance',
    coalesce(nullif(v_row->>'balance','')::numeric,0)
  );
end;
$$;

-- ============================================================
-- 逾期退款主程序
-- ============================================================
drop function if exists public.app_process_expired_anybuy_refunds();

create function public.app_process_expired_anybuy_refunds()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_name text;
  v_member_no text;

  v_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_balances jsonb := '[]'::jsonb;
  v_wallet_tx jsonb := '[]'::jsonb;

  v_order jsonb;
  v_item jsonb;
  v_p jsonb;
  v_elem jsonb;

  v_order_id text;
  v_product_id text;
  v_code text;
  v_name_item text;

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
  v_new_refunds jsonb;
  v_new_balances jsonb;
  v_new_wallet_tx jsonb;
  v_new_products jsonb;

  v_now timestamptz := now();
  v_refund_id text;
  v_count integer := 0;
  v_total_credited numeric := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone,coalesce(name,'')
  into v_phone,v_name
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no := 'YJ'||v_phone;

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

  -- 店舖結帳 + 億家Pay 訂單一起處理
  for v_order in
    select value
    from jsonb_array_elements(v_orders || v_pay_orders)
    where (
      value->>'memberId'=v_uid::text
      or value->>'memberNo'=v_member_no
      or value->>'memberPhone'=v_phone
    )
    and (
      coalesce(value->>'paymentStatus','')='paid'
      or coalesce(value->>'status','') in ('已付款','付款完成')
    )
  loop
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
      v_name_item := coalesce(v_item->>'name','商品');

      -- 防止重複退款
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

      -- 優先使用會員商品實際 validUntil；
      -- 找不到時才用 paidAt + validityDays。
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
          v_bundle_qty * greatest(
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
          v_bundle_price * greatest(
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

      -- 轉贈只會把 remainingQuantity 從 A 移到 B，
      -- 所以把所有會員手上同一原訂單/商品的剩餘加總，才是到期未兌換數。
      select coalesce(sum(
        greatest(
          0,
          coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)
        )
      ),0)
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

      v_remaining_qty := least(v_total_qty,greatest(0,v_remaining_qty));
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

        'memberId',v_uid::text,
        'memberNo',v_member_no,
        'memberPhone',v_phone,
        'memberName',v_name,

        'orderId',v_order_id,
        'paymentCode',v_order->>'paymentCode',
        'productId',v_product_id,
        'code',v_code,
        'name',v_name_item,

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
          to_char(v_valid_until at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',

        'walletCreditedAt',
          to_char(v_now at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',

        'createdAt',
          to_char(v_now at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
      );

      v_refunds := v_refunds || jsonb_build_array(v_new_refund);

      -- 即使退款為 0，也要留下已處理紀錄，避免每次重算。
      if v_refund_amount > 0 then
        select elem
        into v_balance_row
        from jsonb_array_elements(v_balances) elem
        where elem->>'memberId'=v_uid::text
           or elem->>'memberNo'=v_member_no
           or elem->>'memberPhone'=v_phone
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
                'memberId',v_uid::text,
                'memberNo',v_member_no,
                'memberPhone',v_phone,
                'balance',v_balance,
                'updatedAt',
                  to_char(v_now at time zone 'Asia/Taipei',
                          'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
              )
            );
        else
          for v_elem in
            select value from jsonb_array_elements(v_balances)
          loop
            if v_elem->>'memberId'=v_uid::text
               or v_elem->>'memberNo'=v_member_no
               or v_elem->>'memberPhone'=v_phone then
              v_elem :=
                v_elem ||
                jsonb_build_object(
                  'balance',v_balance,
                  'updatedAt',
                    to_char(v_now at time zone 'Asia/Taipei',
                            'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
                );
            end if;
            v_new_balances := v_new_balances || jsonb_build_array(v_elem);
          end loop;
          v_balances := v_new_balances;
        end if;

        v_new_tx := jsonb_build_object(
          'id',gen_random_uuid()::text,
          'type','逾期退款',
          'direction','credit',
          'amount',v_refund_amount,
          'balanceAfter',v_balance,
          'memberId',v_uid::text,
          'memberNo',v_member_no,
          'memberPhone',v_phone,
          'orderId',v_order_id,
          'productId',v_product_id,
          'code',v_code,
          'name',v_name_item,
          'expiryRefundId',v_refund_id,
          'createdAt',
            to_char(v_now at time zone 'Asia/Taipei',
                    'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
        );

        v_wallet_tx := v_wallet_tx || jsonb_build_array(v_new_tx);
        v_total_credited := v_total_credited + v_refund_amount;
      end if;

      -- 所有會員手上屬於此原訂單商品的剩餘數量全部到期失效。
      v_new_products := '[]'::jsonb;
      for v_elem in
        select value from jsonb_array_elements(v_products)
      loop
        if v_elem->>'orderId'=v_order_id
           and (
             v_elem->>'productId'=v_product_id
             or (
               nullif(v_code,'') is not null
               and v_elem->>'code'=v_code
             )
           )
           and coalesce(nullif(v_elem->>'remainingQuantity','')::numeric,0)>0
        then
          v_elem :=
            v_elem ||
            jsonb_build_object(
              'status','已逾期',
              'remainingQuantity',0,
              'expiredAt',
                to_char(v_now at time zone 'Asia/Taipei',
                        'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
              'expiryRefundId',v_refund_id,
              'updatedAt',
                to_char(v_now at time zone 'Asia/Taipei',
                        'YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
            );
        end if;

        v_new_products :=
          v_new_products || jsonb_build_array(v_elem);
      end loop;

      v_products := v_new_products;
      v_count := v_count + 1;
    end loop;
  end loop;

  -- 寫回逾期退款紀錄
  if exists(
    select 1
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_expiry_refunds'
  ) then
    update public.yijia_app_state
    set data=v_refunds,updated_at=now()
    where store_id='HQ' and data_key='yj_app_expiry_refunds';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_expiry_refunds',v_refunds,now());
  end if;

  -- 寫回錢包餘額
  if exists(
    select 1
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_wallet_balances'
  ) then
    update public.yijia_app_state
    set data=v_balances,updated_at=now()
    where store_id='HQ' and data_key='yj_app_wallet_balances';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_wallet_balances',v_balances,now());
  end if;

  -- 寫回錢包明細
  if exists(
    select 1
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_wallet_transactions'
  ) then
    update public.yijia_app_state
    set data=v_wallet_tx,updated_at=now()
    where store_id='HQ' and data_key='yj_app_wallet_transactions';
  else
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_wallet_transactions',v_wallet_tx,now());
  end if;

  -- 寫回商品到期狀態
  if exists(
    select 1
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_member_products'
  ) then
    update public.yijia_app_state
    set data=v_products,updated_at=now()
    where store_id='HQ' and data_key='yj_app_member_products';
  end if;

  return jsonb_build_object(
    'processedCount',v_count,
    'creditedAmount',v_total_credited
  );
end;
$$;

-- ============================================================
-- 目前會員的逾期退款紀錄
-- ============================================================
drop function if exists public.app_get_expiry_refund_history();

create function public.app_get_expiry_refund_history()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_member_no text;
  v_data jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select phone
  into v_phone
  from public.app_members
  where auth_user_id=v_uid
  limit 1;

  if v_phone is null then raise exception 'member profile not found'; end if;
  v_member_no := 'YJ'||v_phone;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_data
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_expiry_refunds'
  limit 1;

  select coalesce(jsonb_agg(elem order by elem->>'createdAt' desc),'[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_data) elem
  where elem->>'memberId'=v_uid::text
     or elem->>'memberNo'=v_member_no
     or elem->>'memberPhone'=v_phone;

  return v_result;
end;
$$;

revoke all on function public.app_get_yijiapay_wallet_balance() from public;
revoke all on function public.app_process_expired_anybuy_refunds() from public;
revoke all on function public.app_get_expiry_refund_history() from public;

grant execute on function public.app_get_yijiapay_wallet_balance() to authenticated;
grant execute on function public.app_process_expired_anybuy_refunds() to authenticated;
grant execute on function public.app_get_expiry_refund_history() to authenticated;

notify pgrst,'reload schema';
