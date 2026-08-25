-- 億家 App v0.10.2.0
-- 隨買跨店取：店舖結帳「購買當下價格快照」正式化
--
-- SC 商品欄位定義：
-- originalPrice      = 一整組原價，例如 500
-- price              = 一整組當時售價，例如 250
-- quantity           = 每組商品數量，例如 10
-- groupCount         = 組數規格（目前例如 1）
-- maxPurchaseGroups  = 限購組數，0 = 不限購
--
-- 下單時由後端直接讀取當下 SC 商品資料建立快照。
-- 不信任 App 傳進來的價格，因此日後 SC 改價不會影響已成立的舊訂單。

drop function if exists public.app_create_store_checkout_order(jsonb);

create function public.app_create_store_checkout_order(
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_name text;
  v_member_no text;

  v_order_id text;
  v_payment_code text;
  v_uuid text;
  v_deadline timestamptz := now() + interval '24 hours';
  v_now timestamptz := now();

  v_item jsonb;
  v_product jsonb;
  v_product_key text;

  v_cart_qty integer;
  v_group_count integer;
  v_bundle_qty integer;
  v_total_qty integer;
  v_max_purchase_groups integer;

  v_original_price numeric := 0;
  v_sale_price numeric := 0;
  v_original_unit_price numeric := 0;
  v_line_total numeric := 0;
  v_total numeric := 0;

  v_items jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_new_order jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty';
  end if;

  select phone, coalesce(name,'')
  into v_phone, v_name
  from public.app_members
  where auth_user_id = v_uid
  limit 1;

  if v_phone is null then
    raise exception 'member profile not found';
  end if;

  v_member_no := 'YJ' || v_phone;

  v_uuid := gen_random_uuid()::text;

  v_order_id :=
    'AO'
    || to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
    || lpad((floor(random()*1000))::int::text,3,'0');

  v_payment_code :=
    'YS'
    || to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISS')
    || lpad((floor(random()*1000))::int::text,3,'0');

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_product_key := nullif(v_item->>'productKey','');

    if v_product_key is null then
      raise exception 'product key is required';
    end if;

    v_cart_qty :=
      greatest(
        1,
        coalesce(nullif(v_item->>'cartQty','')::integer,1)
      );

    -- 由 SC 正式商品主檔重新取得「下單當下」資料。
    select elem
    into v_product
    from public.yijia_app_state s,
         lateral jsonb_array_elements(s.data::jsonb) elem
    where s.store_id = '001'
      and s.data_key = 'yj_app_anybuy_products'
      and coalesce((elem->>'active')::boolean,true) = true
      and (
        elem->>'code' = v_product_key
        or elem->>'id' = v_product_key
      )
    limit 1;

    if v_product is null then
      raise exception 'product not found or inactive: %', v_product_key;
    end if;

    v_group_count :=
      greatest(
        1,
        coalesce(
          nullif(v_product->>'groupCount','')::integer,
          1
        )
      );

    v_bundle_qty :=
      greatest(
        1,
        coalesce(
          nullif(v_product->>'quantity','')::integer,
          1
        )
      );

    v_max_purchase_groups :=
      greatest(
        0,
        coalesce(
          nullif(v_product->>'maxPurchaseGroups','')::integer,
          0
        )
      );

    -- 後端再檢查一次限購，不能只靠 App UI。
    if v_max_purchase_groups > 0
       and v_cart_qty > v_max_purchase_groups then
      raise exception
        'purchase limit exceeded: % max % groups',
        coalesce(v_product->>'name',v_product_key),
        v_max_purchase_groups;
    end if;

    v_original_price :=
      greatest(
        0,
        coalesce(
          nullif(v_product->>'originalPrice','')::numeric,
          0
        )
      );

    v_sale_price :=
      greatest(
        0,
        coalesce(
          nullif(v_product->>'price','')::numeric,
          0
        )
      );

    if v_sale_price <= 0 then
      raise exception 'invalid sale price: %', v_product_key;
    end if;

    -- 單個商品原價只做退款計算快照，不作為售價。
    v_original_unit_price :=
      case
        when v_original_price > 0 and v_bundle_qty > 0
          then v_original_price / v_bundle_qty
        else 0
      end;

    v_total_qty := v_bundle_qty * v_cart_qty;
    v_line_total := v_sale_price * v_cart_qty;
    v_total := v_total + v_line_total;

    v_items :=
      v_items ||
      jsonb_build_array(
        jsonb_build_object(
          'productId', coalesce(v_product->>'id',v_product->>'code'),
          'code', coalesce(v_product->>'code',v_product_key),
          'name', coalesce(v_product->>'name','商品'),
          'category', coalesce(v_product->>'category','隨買'),

          -- 購買當下價格快照
          'originalPrice', v_original_price,
          'originalBundlePrice', v_original_price,
          'price', v_sale_price,
          'salePrice', v_sale_price,
          'bundlePrice', v_sale_price,
          'originalUnitPrice', v_original_unit_price,

          -- 購買當下規格快照
          'groupCount', v_group_count,
          'bundleQuantity', v_bundle_qty,
          'quantity', v_total_qty,
          'cartQuantity', v_cart_qty,
          'maxPurchaseGroups', v_max_purchase_groups,

          -- 本品項實付
          'paidAmount', v_line_total,

          'validityDays',
            greatest(
              0,
              coalesce(nullif(v_product->>'validityDays','')::integer,0)
            ),

          'activityStartDate',
            coalesce(v_product->>'activityStartDate',''),

          'activityEndDate',
            coalesce(v_product->>'activityEndDate',''),

          'activityContent',
            coalesce(v_product->>'activityContent',''),

          'purchaseSnapshot',
            jsonb_build_object(
              'capturedAt',
                to_char(
                  v_now at time zone 'Asia/Taipei',
                  'YYYY-MM-DD"T"HH24:MI:SS'
                ) || '+08:00',

              'originalBundlePrice', v_original_price,
              'saleBundlePrice', v_sale_price,
              'bundleQuantity', v_bundle_qty,
              'groupCount', v_group_count,
              'purchasedGroups', v_cart_qty,
              'totalQuantity', v_total_qty,
              'paidAmount', v_line_total,
              'originalUnitPrice', v_original_unit_price,
              'maxPurchaseGroups', v_max_purchase_groups
            )
        )
      );
  end loop;

  v_new_order :=
    jsonb_build_object(
      'id', v_uuid,
      'orderId', v_order_id,
      'paymentCode', v_payment_code,

      'memberId', v_uid::text,
      'memberNo', v_member_no,
      'memberPhone', v_phone,
      'memberName', v_name,

      'paymentMethod', '店舖結帳',
      'status', '待付款',
      'paymentStatus', 'pending',

      'total', v_total,

      -- 訂單層級也固定保存下單時間
      'priceSnapshotAt',
        to_char(
          v_now at time zone 'Asia/Taipei',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) || '+08:00',

      'paymentDeadline',
        to_char(
          v_deadline at time zone 'Asia/Taipei',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) || '+08:00',

      'items', v_items,

      'createdAt',
        to_char(
          v_now at time zone 'Asia/Taipei',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) || '+08:00',

      'updatedAt',
        to_char(
          v_now at time zone 'Asia/Taipei',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) || '+08:00'
    );

  -- 同一個共用 JSON key 以 row lock 保護。
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_orders
  from public.yijia_app_state
  where store_id = 'HQ'
    and data_key = 'yj_app_anybuy_orders'
  limit 1
  for update;

  if not found then
    insert into public.yijia_app_state(
      store_id,
      data_key,
      data,
      updated_at
    )
    values(
      'HQ',
      'yj_app_anybuy_orders',
      jsonb_build_array(v_new_order),
      now()
    );
  else
    update public.yijia_app_state
    set
      data = v_orders || jsonb_build_array(v_new_order),
      updated_at = now()
    where store_id = 'HQ'
      and data_key = 'yj_app_anybuy_orders';
  end if;

  return v_new_order;
end;
$$;

revoke all
on function public.app_create_store_checkout_order(jsonb)
from public;

grant execute
on function public.app_create_store_checkout_order(jsonb)
to authenticated;

notify pgrst, 'reload schema';
