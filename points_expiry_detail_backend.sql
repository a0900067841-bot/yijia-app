-- 億家 App v0.10.10.8 Points Expiry Detail
-- 顯示會員即將到期點數明細。
-- 優先讀 HQ yj4_members.pointLedger 裡具有 expiryDate 的正數贈點；
-- 若沒有明細，則回退 app_points.expiring_points / expiry_date。

begin;

create or replace function public.app_get_my_expiring_points()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := '';
  v_member_no text := '';
  v_current jsonb := '{}'::jsonb;

  v_members jsonb := '[]'::jsonb;
  v_member jsonb;
  v_ledger jsonb := '[]'::jsonb;

  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;

  v_fallback_points integer := 0;
  v_fallback_date date;
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

  select coalesce(data::jsonb,'[]'::jsonb)
    into v_members
  from public.yijia_app_state
  where store_id='HQ'
    and data_key='yj4_members'
  order by updated_at desc
  limit 1;

  if jsonb_typeof(v_members)='array' then
    select elem
      into v_member
    from jsonb_array_elements(v_members) elem
    where
      coalesce(elem->>'authUserId',elem->>'auth_user_id','')=v_uid::text
      or (
        v_phone<>''
        and regexp_replace(coalesce(elem->>'phone',''),'[^0-9]','','g')=v_phone
      )
      or (
        v_member_no<>''
        and upper(trim(coalesce(elem->>'memberNo',elem->>'code','')))=v_member_no
      )
    limit 1;
  end if;

  if v_member is not null
     and jsonb_typeof(v_member->'pointLedger')='array' then
    v_ledger := v_member->'pointLedger';

    with exp as (
      select
        coalesce(nullif(elem->>'points','')::integer,0) as points,
        nullif(elem->>'expiryDate','')::date as expiry_date,
        coalesce(
          nullif(elem->>'campaignName',''),
          nullif(elem->>'source',''),
          '點數'
        ) as label
      from jsonb_array_elements(v_ledger) elem
      where coalesce(nullif(elem->>'points','')::integer,0)>0
        and coalesce(elem->>'expiryDate','')<>''
        and nullif(elem->>'expiryDate','')::date >=
            (now() at time zone 'Asia/Taipei')::date
    ),
    grouped as (
      select
        expiry_date,
        label,
        sum(points)::integer as points
      from exp
      group by expiry_date,label
    )
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'expiryDate',to_char(expiry_date,'YYYY/MM/DD'),
            'label',label,
            'points',points
          )
          order by expiry_date,label
        ),
        '[]'::jsonb
      ),
      coalesce(sum(points),0)::integer
    into v_rows,v_total
    from grouped;
  end if;

  -- 沒有 HQ 明細時，沿用 App 目前已存在的到期點數彙總。
  if v_total=0 then
    select
      coalesce(expiring_points,0),
      expiry_date
    into
      v_fallback_points,
      v_fallback_date
    from public.app_points
    where auth_user_id=v_uid
    limit 1;

    if coalesce(v_fallback_points,0)>0 then
      v_total := v_fallback_points;
      v_rows := jsonb_build_array(
        jsonb_build_object(
          'expiryDate',
            case
              when v_fallback_date is null then '指定日期'
              else to_char(v_fallback_date,'YYYY/MM/DD')
            end,
          'label','即將到期點數',
          'points',v_fallback_points
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'totalExpiringPoints',coalesce(v_total,0),
    'rows',coalesce(v_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.app_get_my_expiring_points() from public;
grant execute on function public.app_get_my_expiring_points() to authenticated;

notify pgrst,'reload schema';

commit;

select 'POINTS_EXPIRY_DETAIL_V0_10_10_8_READY' as result;
