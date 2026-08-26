begin;

create or replace function public.app_get_my_point_history()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_member_no text := '';
  v_yj_phone text := '';
  v_current jsonb;
  v_result jsonb;
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
    v_current := public.app_current_member_json();
  exception when others then
    v_current := '{}'::jsonb;
  end;

  v_member_no := upper(trim(coalesce(
    v_current->>'memberNo',
    v_current->>'member_no',
    ''
  )));

  if v_phone<>'' then
    v_yj_phone := upper('YJ'||v_phone);
  end if;

  with event_rows as (
    select
      e.source_id,
      e.event_type as transaction_type,
      e.delta as points,
      e.description,
      e.balance_after,
      e.created_at
    from public.yijia_member_point_sync_events e
    where
      (
        v_phone<>''
        and regexp_replace(coalesce(e.phone,''),'[^0-9]','','g')=v_phone
      )
      or (
        v_member_no<>''
        and upper(trim(coalesce(e.member_no,'')))=v_member_no
      )
      or (
        v_yj_phone<>''
        and upper(trim(coalesce(e.member_no,'')))=v_yj_phone
      )
  ),
  app_only_rows as (
    select
      coalesce(t.source_id,'APP-TX:'||t.id::text) as source_id,
      t.transaction_type,
      t.points,
      t.description,
      null::integer as balance_after,
      t.created_at
    from public.app_point_transactions t
    where t.auth_user_id=v_uid
      and not exists (
        select 1
        from event_rows e
        where e.source_id is not null
          and t.source_id is not null
          and e.source_id=t.source_id
      )
  ),
  all_rows as (
    select * from event_rows
    union all
    select * from app_only_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceId',source_id,
        'transactionType',transaction_type,
        'points',points,
        'description',description,
        'balanceAfter',balance_after,
        'createdAt',created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from all_rows
    order by created_at desc
    limit 100
  ) x;

  return v_result;
end;
$$;

revoke all on function public.app_get_my_point_history() from public;
grant execute on function public.app_get_my_point_history() to authenticated;

notify pgrst,'reload schema';

commit;

select 'POINT_LEDGER_SYNC_V0_10_9_8_READY' as result;
