-- 億家 App v0.9.4.3：我的商品持續顯示 YR 退貨條碼
create or replace function public.app_get_member_products()
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
  v_elem jsonb;
  v_req jsonb;
  v_order jsonb;
  v_purchase_at timestamptz;
  v_deadline timestamptz;
  v_return_eligible boolean;
  v_return_status text;
  v_result jsonb := '[]'::jsonb;
begin
  select coalesce(data::jsonb,'[]'::jsonb)
  into v_products
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_member_products'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_returns
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_return_requests'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_store_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_anybuy_orders'
  limit 1;

  select coalesce(data::jsonb,'[]'::jsonb)
  into v_pay_orders
  from public.yijia_app_state
  where store_id='HQ' and data_key='yj_app_yijiapay_orders'
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

    v_order := null;
    if nullif(v_elem->>'paymentCode','') is not null then
      select o into v_order
      from jsonb_array_elements(coalesce(v_store_orders,'[]'::jsonb)) o
      where o->>'paymentCode'=v_elem->>'paymentCode'
         or o->>'orderId'=v_elem->>'orderId'
      limit 1;
    end if;

    if v_order is null and nullif(v_elem->>'orderId','') is not null then
      select o into v_order
      from jsonb_array_elements(coalesce(v_pay_orders,'[]'::jsonb)) o
      where o->>'orderId'=v_elem->>'orderId'
      limit 1;
    end if;

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
      and coalesce(nullif(v_elem->>'originalQuantity','')::numeric,0)>0
      and coalesce(nullif(v_elem->>'originalQuantity','')::numeric,0)
          = coalesce(nullif(v_elem->>'remainingQuantity','')::numeric,0)
      and v_deadline is not null
      and now()<=v_deadline;

    v_result := v_result || jsonb_build_array(
      v_elem ||
      jsonb_build_object(
        'returnEligible',v_return_eligible,
        'returnDeadline',case when v_deadline is null then null
          else to_char(v_deadline at time zone 'Asia/Taipei','YYYY-MM-DD"T"HH24:MI:SS')||'+08:00' end,
        'returnRequestStatus',v_return_status,
        'returnRequestId',case when v_req is null then null else v_req->>'id' end,
        'returnCode',case when v_req is null then null else v_req->>'returnCode' end,
        'returnRequestCreatedAt',case when v_req is null then null else v_req->>'createdAt' end,
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


revoke all on function public.app_get_member_products() from public;
grant execute on function public.app_get_member_products() to authenticated;
notify pgrst,'reload schema';
