create or replace function public.app_get_point_business_history()
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

  with reward_rows as (
    select 'reward'::text as type,
           r.reward_name as name,
           r.points_used as points_used,
           null::numeric as discount_amount,
           coalesce(r.fulfillment_status,'available') as status,
           r.created_at as created_at,
           r.fulfilled_store_code as store_code,
           r.tm_sale_id as sale_id
    from public.app_point_reward_redemptions r
    where r.auth_user_id=v_uid
  ),
  discount_ticket_rows as (
    select 'discount'::text as type,
           '點數折抵'::text as name,
           t.points as points_used,
           t.discount_amount as discount_amount,
           t.status as status,
           t.created_at as created_at,
           t.used_store_code as store_code,
           t.tm_sale_id as sale_id
    from public.app_point_discount_tickets t
    where t.auth_user_id=v_uid
  ),
  discount_checkout_rows as (
    select 'discount'::text as type,
           '點數折抵'::text as name,
           u.points_used as points_used,
           u.discount_amount as discount_amount,
           u.status as status,
           u.created_at as created_at,
           null::text as store_code,
           u.order_ref as sale_id
    from public.app_point_discount_usages u
    where u.auth_user_id=v_uid
      and not exists (
        select 1
        from public.app_point_discount_tickets t
        where t.auth_user_id=v_uid
          and t.tm_sale_id=u.order_ref
      )
  ),
  all_rows as (
    select * from reward_rows
    union all
    select * from discount_ticket_rows
    union all
    select * from discount_checkout_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type',type,
        'name',name,
        'pointsUsed',points_used,
        'discountAmount',discount_amount,
        'status',status,
        'createdAt',created_at,
        'storeCode',store_code,
        'saleId',sale_id
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from all_rows;

  return v_result;
end;
$$;

revoke all on function public.app_get_point_business_history() from public;
grant execute on function public.app_get_point_business_history() to authenticated;
notify pgrst,'reload schema';
