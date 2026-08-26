begin;

create or replace function public.app_get_my_point_discount_tickets()
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

  update public.app_point_discount_tickets
  set status='expired'
  where auth_user_id=v_uid
    and status='pending'
    and expires_at<=now();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'discountCode',t.discount_code,
        'points',t.points,
        'discountAmount',t.discount_amount,
        'status',t.status,
        'expiresAt',t.expires_at,
        'createdAt',t.created_at,
        'usedAt',t.used_at,
        'usedStoreCode',t.used_store_code,
        'tmSaleId',t.tm_sale_id
      )
      order by t.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.app_point_discount_tickets
    where auth_user_id=v_uid
    order by created_at desc
    limit 20
  ) t;

  return v_result;
end;
$$;

create or replace function public.app_cancel_point_discount_ticket(
  p_discount_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.app_point_discount_tickets%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select *
  into v_row
  from public.app_point_discount_tickets
  where auth_user_id=v_uid
    and discount_code=trim(p_discount_code)
  for update;

  if v_row.id is null then
    raise exception 'point discount ticket not found';
  end if;

  if v_row.status='used' then
    raise exception 'used ticket cannot be cancelled';
  end if;

  if v_row.status in ('expired','cancelled') then
    return jsonb_build_object(
      'ok',true,
      'discountCode',v_row.discount_code,
      'status',v_row.status
    );
  end if;

  if v_row.expires_at<=now() then
    update public.app_point_discount_tickets
    set status='expired'
    where id=v_row.id;

    return jsonb_build_object(
      'ok',true,
      'discountCode',v_row.discount_code,
      'status','expired'
    );
  end if;

  update public.app_point_discount_tickets
  set status='cancelled'
  where id=v_row.id;

  return jsonb_build_object(
    'ok',true,
    'discountCode',v_row.discount_code,
    'status','cancelled'
  );
end;
$$;

revoke all on function public.app_get_my_point_discount_tickets() from public;
revoke all on function public.app_cancel_point_discount_ticket(text) from public;

grant execute on function public.app_get_my_point_discount_tickets() to authenticated;
grant execute on function public.app_cancel_point_discount_ticket(text) to authenticated;

notify pgrst,'reload schema';

commit;

select 'POINT_DISCOUNT_TICKET_MANAGER_V0_10_10_4_READY' as result;
