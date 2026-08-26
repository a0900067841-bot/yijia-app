-- 億家 App v0.10.9.7 Member Point Identity Sync
-- 修正 App 點數仍顯示 0：
-- 1. 不只用 phone / auth_user_id 比對。
-- 2. 同時比對 memberNo / code / YJ+手機號碼。
-- 3. 若 HQ yj4_members 沒找到，改查 yijia_member_point_sync_events 最新 balance_after。
-- 4. 找到後直接回填 app_points，讓 App 立即顯示 TM / SC 最新點數。

begin;

create or replace function public.app_sync_my_points_from_hq()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();

  v_app_member public.app_members%rowtype;
  v_current jsonb;

  v_phone text := '';
  v_member_no text := '';
  v_yj_phone text := '';

  v_members jsonb := '[]'::jsonb;
  v_member jsonb;

  v_hq_points integer;
  v_event_points integer;
  v_app_points integer := 0;

  v_balance integer := 0;
  v_source text := 'app_points';
  v_match text := 'none';

  v_expiring integer := 0;
  v_expiry date;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select *
    into v_app_member
  from public.app_members
  where auth_user_id=v_uid
  order by updated_at desc nulls last
  limit 1;

  if v_app_member.id is null then
    raise exception 'app member not found';
  end if;

  v_phone :=
    regexp_replace(
      coalesce(v_app_member.phone,''),
      '[^0-9]','','g'
    );

  -- 沿用既有正式會員 JSON，取得會員編號。
  begin
    v_current := public.app_current_member_json();
  exception when others then
    v_current := '{}'::jsonb;
  end;

  v_member_no :=
    upper(trim(coalesce(
      v_current->>'memberNo',
      v_current->>'member_no',
      ''
    )));

  if v_phone<>'' then
    v_yj_phone := upper('YJ'||v_phone);
  end if;

  -- 先讀 App 目前資料，作為最後 fallback。
  select
    coalesce(available_points,0),
    coalesce(expiring_points,0),
    expiry_date
  into
    v_app_points,
    v_expiring,
    v_expiry
  from public.app_points
  where auth_user_id=v_uid
  limit 1;

  v_app_points := coalesce(v_app_points,0);

  -- =====================================================
  -- A. HQ 共用會員主檔 yj4_members
  --    比對順序：
  --    authUserId / auth_user_id / id
  --    phone
  --    memberNo / code
  --    YJ+phone
  -- =====================================================
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
      or coalesce(elem->>'id','')=v_uid::text
      or (
        v_phone<>''
        and regexp_replace(coalesce(elem->>'phone',''),'[^0-9]','','g')=v_phone
      )
      or (
        v_member_no<>''
        and upper(trim(coalesce(elem->>'memberNo',elem->>'code','')))=v_member_no
      )
      or (
        v_yj_phone<>''
        and upper(trim(coalesce(elem->>'memberNo',elem->>'code','')))=v_yj_phone
      )
    order by
      case
        when coalesce(elem->>'authUserId',elem->>'auth_user_id','')=v_uid::text then 1
        when coalesce(elem->>'id','')=v_uid::text then 2
        when v_phone<>'' and regexp_replace(coalesce(elem->>'phone',''),'[^0-9]','','g')=v_phone then 3
        when v_member_no<>'' and upper(trim(coalesce(elem->>'memberNo',elem->>'code','')))=v_member_no then 4
        when v_yj_phone<>'' and upper(trim(coalesce(elem->>'memberNo',elem->>'code','')))=v_yj_phone then 5
        else 99
      end
    limit 1;
  end if;

  if v_member is not null then
    v_hq_points :=
      coalesce(
        nullif(v_member->>'points','')::integer,
        0
      );

    if coalesce(v_member->>'authUserId',v_member->>'auth_user_id','')=v_uid::text then
      v_match := 'auth_user_id';
    elsif coalesce(v_member->>'id','')=v_uid::text then
      v_match := 'id';
    elsif v_phone<>'' and regexp_replace(coalesce(v_member->>'phone',''),'[^0-9]','','g')=v_phone then
      v_match := 'phone';
    elsif v_member_no<>'' and upper(trim(coalesce(v_member->>'memberNo',v_member->>'code','')))=v_member_no then
      v_match := 'memberNo';
    elsif v_yj_phone<>'' and upper(trim(coalesce(v_member->>'memberNo',v_member->>'code','')))=v_yj_phone then
      v_match := 'YJ+phone';
    end if;
  end if;

  -- =====================================================
  -- B. TM / SC 正式點數同步事件
  --    最新 balance_after 是該會員最近一次同步後的餘額。
  -- =====================================================
  select e.balance_after
    into v_event_points
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
  order by e.created_at desc
  limit 1;

  -- 最新同步事件優先；沒有事件才用 HQ 主檔；都沒有才保留 app_points。
  if v_event_points is not null then
    v_balance := v_event_points;
    v_source := 'yijia_member_point_sync_events';
    if v_match='none' then v_match := 'event phone/memberNo'; end if;
  elsif v_hq_points is not null then
    v_balance := v_hq_points;
    v_source := 'HQ:yj4_members';
  else
    v_balance := v_app_points;
    v_source := 'app_points';
  end if;

  -- 回填 App 點數表
  update public.app_points
  set
    phone=v_phone,
    available_points=v_balance,
    updated_at=now()
  where auth_user_id=v_uid;

  if not found then
    insert into public.app_points(
      auth_user_id,
      phone,
      available_points,
      expiring_points,
      updated_at
    )
    values(
      v_uid,
      v_phone,
      v_balance,
      coalesce(v_expiring,0),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'authUserId',v_uid,
    'phone',v_phone,
    'memberNo',v_member_no,
    'yjPhoneCode',v_yj_phone,
    'availablePoints',v_balance,
    'hqPoints',v_hq_points,
    'eventPoints',v_event_points,
    'appPointsBefore',v_app_points,
    'expiringPoints',coalesce(v_expiring,0),
    'expiryDate',v_expiry,
    'source',v_source,
    'matchedBy',v_match,
    'updatedAt',now()
  );
end;
$$;

revoke all on function public.app_sync_my_points_from_hq() from public;
grant execute on function public.app_sync_my_points_from_hq() to authenticated;

notify pgrst,'reload schema';

commit;

select 'MEMBER_POINT_IDENTITY_SYNC_V0_10_9_7_READY' as result;
