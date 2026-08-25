-- 億家 App v0.9.9 — 隨買跨店取退貨退款正式試算
--
-- 核心公式：
-- 退款金額 = 付款金額
--          -（已兌換／預約完整組數 × 一組商品金額）
--          - min（未滿一組已使用商品數 × 單個商品原價, 一組商品金額）
-- 最低為 0 元，不另向會員補收。
--
-- 轉贈視同已兌換／領取：
-- 本版以 originalQuantity - remainingQuantity 為主要已使用數量，
-- 並與 redeemedQuantity + reservedQuantity + transferredQuantity 取較大值，
-- 因此只要轉贈流程有扣除 remainingQuantity，就會自動納入。
--
-- 注意：
-- 若「未滿一組已使用數量 > 0」，系統必須知道「單個商品原價」。
-- 支援欄位名稱：
-- originalUnitPrice / unitOriginalPrice / singleOriginalPrice / singlePrice / originalPrice
-- 建議 SC 隨買商品正式使用 originalUnitPrice。
--
-- 本版保留現行主動退貨 7 日期限，並移除「有兌換就完全不能退」限制。
-- 逾兌換期限自動退款是下一階段，不在本 SQL 直接執行錢包入帳。

create extension if not exists pgcrypto;

-- ---------- 退款計算器 ----------
drop function if exists public.app_calc_anybuy_refund(jsonb,jsonb);

create function public.app_calc_anybuy_refund(
  p_product jsonb,
  p_order jsonb
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_item jsonb;
  v_total_qty numeric := 0;
  v_remaining numeric := 0;
  v_used_by_balance numeric := 0;
  v_used_explicit numeric := 0;
  v_used_qty numeric := 0;

  v_cart_qty numeric := 1;
  v_bundle_qty numeric := 1;
  v_bundle_price numeric := 0;
  v_paid_amount numeric := 0;
  v_unit_original numeric := 0;

  v_full_groups numeric := 0;
  v_partial_qty numeric := 0;
  v_partial_deduction numeric := 0;
  v_refund numeric := 0;
  v_ready boolean := true;
  v_reason text := null;
begin
  -- 找到訂單中對應商品
  select i into v_item
  from jsonb_array_elements(coalesce(p_order->'items','[]'::jsonb)) i
  where (
    nullif(p_product->>'productId','') is not null
    and i->>'productId'=p_product->>'productId'
  ) or (
    nullif(p_product->>'code','') is not null
    and i->>'code'=p_product->>'code'
  )
  limit 1;

  v_item := coalesce(v_item,'{}'::jsonb);

  -- 購買總件數
  v_total_qty := greatest(0,coalesce(
    case when coalesce(p_product->>'originalQuantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'originalQuantity')::numeric end,
    case when coalesce(v_item->>'quantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'quantity')::numeric end,
    0
  ));

  v_remaining := greatest(0,least(
    v_total_qty,
    coalesce(
      case when coalesce(p_product->>'remainingQuantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'remainingQuantity')::numeric end,
      v_total_qty
    )
  ));

  -- 主要依「原始 - 剩餘」判斷，轉贈只要已扣 remainingQuantity 就會視同使用。
  v_used_by_balance := greatest(0,v_total_qty-v_remaining);

  -- 兼容未來 explicit counter。
  v_used_explicit :=
    greatest(0,coalesce(case when coalesce(p_product->>'redeemedQuantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'redeemedQuantity')::numeric end,0))
    + greatest(0,coalesce(case when coalesce(p_product->>'reservedQuantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'reservedQuantity')::numeric end,0))
    + greatest(0,coalesce(case when coalesce(p_product->>'transferredQuantity','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'transferredQuantity')::numeric end,0));

  v_used_qty := least(v_total_qty,greatest(v_used_by_balance,v_used_explicit));

  v_cart_qty := greatest(1,coalesce(
    case when coalesce(v_item->>'cartQuantity','') ~ '^[0-9]+([.][0-9]+)?$' then (v_item->>'cartQuantity')::numeric end,
    case when coalesce(p_product->>'cartQuantity','') ~ '^[0-9]+([.][0-9]+)?$' then (p_product->>'cartQuantity')::numeric end,
    1
  ));

  v_bundle_qty := greatest(1,coalesce(
    case when coalesce(v_item->>'bundleQuantity','') ~ '^[0-9]+([.][0-9]+)?$' then (v_item->>'bundleQuantity')::numeric end,
    case when coalesce(p_product->>'bundleQuantity','') ~ '^[0-9]+([.][0-9]+)?$' then (p_product->>'bundleQuantity')::numeric end,
    case when v_cart_qty>0 and v_total_qty>0 then v_total_qty/v_cart_qty end,
    1
  ));

  v_bundle_price := greatest(0,coalesce(
    case when coalesce(v_item->>'bundlePrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'bundlePrice')::numeric end,
    case when coalesce(v_item->>'price','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'price')::numeric end,
    case when coalesce(p_product->>'bundlePrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'bundlePrice')::numeric end,
    case when coalesce(p_product->>'price','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'price')::numeric end,
    0
  ));

  v_paid_amount := greatest(0,coalesce(
    case when coalesce(v_item->>'paidAmount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'paidAmount')::numeric end,
    case when coalesce(p_product->>'paidAmount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'paidAmount')::numeric end,
    v_bundle_price*v_cart_qty
  ));

  v_unit_original := greatest(0,coalesce(
    case when coalesce(v_item->>'originalUnitPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'originalUnitPrice')::numeric end,
    case when coalesce(v_item->>'unitOriginalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'unitOriginalPrice')::numeric end,
    case when coalesce(v_item->>'singleOriginalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'singleOriginalPrice')::numeric end,
    case when coalesce(v_item->>'singlePrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'singlePrice')::numeric end,
    case when coalesce(v_item->>'originalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_item->>'originalPrice')::numeric end,

    case when coalesce(p_product->>'originalUnitPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'originalUnitPrice')::numeric end,
    case when coalesce(p_product->>'unitOriginalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'unitOriginalPrice')::numeric end,
    case when coalesce(p_product->>'singleOriginalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'singleOriginalPrice')::numeric end,
    case when coalesce(p_product->>'singlePrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'singlePrice')::numeric end,
    case when coalesce(p_product->>'originalPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'originalPrice')::numeric end,
    case when coalesce(p_product->>'masterOriginalUnitPrice','') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_product->>'masterOriginalUnitPrice')::numeric end,
    0
  ));

  if v_total_qty<=0 or v_bundle_qty<=0 or v_bundle_price<0 then
    v_ready := false;
    v_reason := '商品組數或付款資料不完整';
  end if;

  v_full_groups := floor(v_used_qty/v_bundle_qty);
  v_partial_qty := mod(v_used_qty,v_bundle_qty);

  if v_partial_qty>0 and v_unit_original<=0 then
    v_ready := false;
    v_reason := '未設定單個商品原價，無法計算未滿一組之退款';
  end if;

  if v_ready then
    v_partial_deduction := least(v_bundle_price,v_partial_qty*v_unit_original);
    v_refund := greatest(
      0,
      v_paid_amount
      - (v_full_groups*v_bundle_price)
      - v_partial_deduction
    );
  else
    v_partial_deduction := 0;
    v_refund := 0;
  end if;

  return jsonb_build_object(
    'refundCalculationReady',v_ready,
    'refundCalculationReason',v_reason,
    'paidAmount',v_paid_amount,
    'bundleQuantity',v_bundle_qty,
    'bundlePrice',v_bundle_price,
    'unitOriginalPrice',v_unit_original,
    'usedQuantity',v_used_qty,
    'fullUsedGroups',v_full_groups,
    'partialUsedQuantity',v_partial_qty,
    'partialUsedDeduction',v_partial_deduction,
    'refundAmount',case when v_ready then v_refund else null end,
    'pointsToDeduct',case when v_ready then v_refund else null end,
    'remainingQuantity',v_remaining
  );
end;
$$;


-- ---------- 我的商品：補上退款試算 ----------
drop function if exists public.app_get_member_products();

create function public.app_get_member_products()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_member_no text := v_m->>'memberNo';

  v_products jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_store_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_master_products jsonb := '[]'::jsonb;

  v_elem jsonb;
  v_req jsonb;
  v_order jsonb;
  v_master jsonb;
  v_calc jsonb;

  v_purchase_at timestamptz;
  v_deadline timestamptz;
  v_return_eligible boolean;
  v_return_status text;
  v_return_code text;
  v_result jsonb := '[]'::jsonb;
begin
  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_returns
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_return_requests'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_store_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_pay_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_orders'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb) into v_master_products
  from public.yijia_app_state
  where store_id='001' and data_key='yj_app_anybuy_products'
  limit 1;

  for v_elem in
    select elem
    from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) elem
    where (
      elem->>'memberId'=v_uid
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid
      or elem->>'memberKey'=v_phone
    )
    and elem->>'status'='可兌換'
    and coalesce(nullif(elem->>'remainingQuantity','')::numeric,0)>0
    and (
      nullif(elem->>'validUntil','') is null
      or (elem->>'validUntil')::timestamptz>=now()
    )
  loop
    v_req := null;
    select r into v_req
    from jsonb_array_elements(coalesce(v_returns,'[]'::jsonb)) r
    where r->>'memberProductId'=v_elem->>'id'
      and coalesce(r->>'status','') not in ('已取消','已駁回')
    order by coalesce(r->>'createdAt','') desc
    limit 1;

    v_return_status := case when v_req is null then null else v_req->>'status' end;
    v_return_code := case when v_req is null then null else v_req->>'returnCode' end;

    v_order := null;
    select o into v_order
    from jsonb_array_elements(coalesce(v_store_orders,'[]'::jsonb)) o
    where o->>'paymentCode'=v_elem->>'paymentCode'
       or o->>'orderId'=v_elem->>'orderId'
    limit 1;

    if v_order is null then
      select o into v_order
      from jsonb_array_elements(coalesce(v_pay_orders,'[]'::jsonb)) o
      where o->>'orderId'=v_elem->>'orderId'
      limit 1;
    end if;

    v_master := null;
    select p into v_master
    from jsonb_array_elements(coalesce(v_master_products,'[]'::jsonb)) p
    where p->>'code'=v_elem->>'code'
       or p->>'id'=v_elem->>'productId'
    limit 1;

    v_calc := public.app_calc_anybuy_refund(
      v_elem || jsonb_build_object(
        'masterOriginalUnitPrice',coalesce(
          v_master->>'originalUnitPrice',
          v_master->>'unitOriginalPrice',
          v_master->>'singleOriginalPrice',
          v_master->>'singlePrice',
          v_master->>'originalPrice'
        )
      ),
      coalesce(v_order,'{}'::jsonb)
    );

    begin
      v_purchase_at := coalesce(
        nullif(v_order->>'paidAt','')::timestamptz,
        nullif(v_elem->>'createdAt','')::timestamptz
      );
    exception when others then
      v_purchase_at := null;
    end;

    v_deadline := case when v_purchase_at is null then null else v_purchase_at + interval '7 days' end;

    v_return_eligible :=
      v_req is null
      and coalesce(v_elem->>'source','') <> '會員轉贈'
      and coalesce(nullif(v_elem->>'remainingQuantity','')::numeric,0)>0
      and v_deadline is not null
      and now()<=v_deadline
      and coalesce((v_calc->>'refundCalculationReady')::boolean,false);

    v_result := v_result || jsonb_build_array(
      v_elem ||
      v_calc ||
      jsonb_build_object(
        'returnEligible',v_return_eligible,
        'returnDeadline',case when v_deadline is null then null
          else to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00' end,
        'returnRequestStatus',v_return_status,
        'returnCode',v_return_code,
        'returnMode',case
          when coalesce(v_elem->>'source','')='店舖結帳'
            or nullif(v_elem->>'paidStoreCode','') is not null
          then 'original_store'
          else 'online'
        end,
        'paidStoreName',coalesce(v_elem->>'paidStoreName',v_order->>'paidStoreName'),
        'paidStoreCode',coalesce(v_elem->>'paidStoreCode',v_order->>'paidStoreCode')
      )
    );
  end loop;

  return v_result;
end;
$$;


-- ---------- 建立退貨申請：允許已兌換／預約／轉贈後退剩餘數量 ----------
drop function if exists public.app_create_return_request(text);

create function public.app_create_return_request(
  p_member_product_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m jsonb := public.app_current_member_json();
  v_uid text := v_m->>'memberId';
  v_phone text := v_m->>'memberPhone';
  v_member_no text := v_m->>'memberNo';

  v_products jsonb := '[]'::jsonb;
  v_returns jsonb := '[]'::jsonb;
  v_store_orders jsonb := '[]'::jsonb;
  v_pay_orders jsonb := '[]'::jsonb;
  v_master_products jsonb := '[]'::jsonb;

  v_product jsonb;
  v_existing jsonb;
  v_order jsonb;
  v_master jsonb;
  v_calc jsonb;

  v_purchase_at timestamptz;
  v_deadline timestamptz;
  v_mode text;
  v_return_code text;
  v_new jsonb;
  v_now timestamptz := now();
begin
  select coalesce(data::jsonb,'[]'::jsonb) into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select elem into v_product
  from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) elem
  where elem->>'id'=p_member_product_id
    and (
      elem->>'memberId'=v_uid
      or elem->>'memberNo'=v_member_no
      or elem->>'memberPhone'=v_phone
      or elem->>'memberKey'=v_uid
      or elem->>'memberKey'=v_phone
    )
  limit 1;

  if v_product is null then raise exception 'member product not found'; end if;
  if v_product->>'status'<>'可兌換' then raise exception 'product is not returnable'; end if;
  if coalesce(v_product->>'source','')='會員轉贈' then raise exception 'gifted product cannot be returned by receiver'; end if;
  if coalesce(nullif(v_product->>'remainingQuantity','')::numeric,0)<=0 then raise exception 'no remaining quantity to return'; end if;

  select coalesce(data::jsonb,'[]'::jsonb) into v_returns
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_return_requests'
  limit 1
  for update;

  if found then
    select r into v_existing
    from jsonb_array_elements(coalesce(v_returns,'[]'::jsonb)) r
    where r->>'memberProductId'=p_member_product_id
      and coalesce(r->>'status','') not in ('已取消','已駁回')
    limit 1;
    if v_existing is not null then raise exception 'return request already exists'; end if;
  end if;

  select coalesce(data::jsonb,'[]'::jsonb) into v_store_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select o into v_order
  from jsonb_array_elements(coalesce(v_store_orders,'[]'::jsonb)) o
  where o->>'paymentCode'=v_product->>'paymentCode'
     or o->>'orderId'=v_product->>'orderId'
  limit 1;

  if v_order is null then
    select coalesce(data::jsonb,'[]'::jsonb) into v_pay_orders
    from public.yijia_app_state
    where store_id='HQ' and data_key='yj_app_yijiapay_orders'
    limit 1;

    select o into v_order
    from jsonb_array_elements(coalesce(v_pay_orders,'[]'::jsonb)) o
    where o->>'orderId'=v_product->>'orderId'
    limit 1;
  end if;

  select coalesce(data::jsonb,'[]'::jsonb) into v_master_products
  from public.yijia_app_state
  where store_id='001' and data_key='yj_app_anybuy_products'
  limit 1;

  select p into v_master
  from jsonb_array_elements(coalesce(v_master_products,'[]'::jsonb)) p
  where p->>'code'=v_product->>'code'
     or p->>'id'=v_product->>'productId'
  limit 1;

  v_calc := public.app_calc_anybuy_refund(
    v_product || jsonb_build_object(
      'masterOriginalUnitPrice',coalesce(
        v_master->>'originalUnitPrice',
        v_master->>'unitOriginalPrice',
        v_master->>'singleOriginalPrice',
        v_master->>'singlePrice',
        v_master->>'originalPrice'
      )
    ),
    coalesce(v_order,'{}'::jsonb)
  );

  if not coalesce((v_calc->>'refundCalculationReady')::boolean,false) then
    raise exception '%',coalesce(v_calc->>'refundCalculationReason','refund calculation unavailable');
  end if;

  begin
    v_purchase_at := coalesce(
      nullif(v_order->>'paidAt','')::timestamptz,
      nullif(v_product->>'createdAt','')::timestamptz
    );
  exception when others then
    v_purchase_at := null;
  end;

  if v_purchase_at is null then raise exception 'purchase time unavailable'; end if;
  v_deadline := v_purchase_at + interval '7 days';
  if now()>v_deadline then raise exception 'return period expired'; end if;

  v_mode := case
    when coalesce(v_product->>'source','')='店舖結帳'
      or nullif(v_product->>'paidStoreCode','') is not null
    then 'original_store'
    else 'online'
  end;

  if v_mode='original_store'
     and coalesce(v_product->>'paidStoreCode',v_order->>'paidStoreCode','')='' then
    raise exception 'original paid store unavailable';
  end if;

  v_return_code := 'YR'
    || to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
    || lpad((floor(random()*1000))::int::text,3,'0');

  v_new := jsonb_build_object(
    'id',gen_random_uuid()::text,
    'returnCode',v_return_code,
    'memberProductId',v_product->>'id',
    'memberId',v_m->>'memberId',
    'memberNo',v_m->>'memberNo',
    'memberPhone',v_m->>'memberPhone',
    'memberName',v_m->>'memberName',

    'orderId',v_product->>'orderId',
    'paymentCode',v_product->>'paymentCode',
    'productId',v_product->>'productId',
    'code',v_product->>'code',
    'name',v_product->>'name',

    'quantity',coalesce(nullif(v_product->>'remainingQuantity','')::numeric,0),
    'originalQuantity',coalesce(nullif(v_product->>'originalQuantity','')::numeric,0),
    'usedQuantity',(v_calc->>'usedQuantity')::numeric,

    'paidAmount',(v_calc->>'paidAmount')::numeric,
    'bundleQuantity',(v_calc->>'bundleQuantity')::numeric,
    'bundlePrice',(v_calc->>'bundlePrice')::numeric,
    'unitOriginalPrice',(v_calc->>'unitOriginalPrice')::numeric,
    'fullUsedGroups',(v_calc->>'fullUsedGroups')::numeric,
    'partialUsedQuantity',(v_calc->>'partialUsedQuantity')::numeric,
    'partialUsedDeduction',(v_calc->>'partialUsedDeduction')::numeric,
    'refundAmount',(v_calc->>'refundAmount')::numeric,
    'pointsToDeduct',(v_calc->>'pointsToDeduct')::numeric,

    'returnMode',v_mode,
    'status',case when v_mode='original_store' then '待回原門市辦理' else '待線上退款' end,
    'paidStoreCode',coalesce(v_product->>'paidStoreCode',v_order->>'paidStoreCode'),
    'paidStoreName',coalesce(v_product->>'paidStoreName',v_order->>'paidStoreName'),
    'tmSaleId',coalesce(v_product->>'tmSaleId',v_order->>'tmSaleId'),

    'purchaseAt',to_char(v_purchase_at at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'returnDeadline',to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'createdAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00',
    'updatedAt',to_char(v_now at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00'
  );

  if not found then
    insert into public.yijia_app_state(store_id,data_key,data,updated_at)
    values('HQ','yj_app_return_requests',jsonb_build_array(v_new),now());
  else
    update public.yijia_app_state
    set data=v_returns||jsonb_build_array(v_new),updated_at=now()
    where store_id='HQ' and data_key='yj_app_return_requests';
  end if;

  return v_new;
end;
$$;

revoke all on function public.app_calc_anybuy_refund(jsonb,jsonb) from public;
revoke all on function public.app_get_member_products() from public;
revoke all on function public.app_create_return_request(text) from public;

grant execute on function public.app_calc_anybuy_refund(jsonb,jsonb) to authenticated;
grant execute on function public.app_get_member_products() to authenticated;
grant execute on function public.app_create_return_request(text) to authenticated;

notify pgrst,'reload schema';
