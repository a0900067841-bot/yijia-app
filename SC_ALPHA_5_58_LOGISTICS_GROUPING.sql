-- 億家 / Yijia SC v5.5.0 SC Alpha 5.58
-- 貨單歸併規則：門市 + 到貨日 + 溫層 + 配次/配送批次
-- 供應商、來源類型、來源單號只保留在明細/追蹤資料，不再作為拆單 key。
-- 不修改物流簽到 / 驗收 RPC；兩個流程維持分離。

begin;

create extension if not exists pgcrypto;

-- 既有主檔補上統一歸併欄位；不刪任何既有欄位/資料。
alter table public.logistics_batches
  add column if not exists delivery_date date,
  add column if not exists delivery_run text,
  add column if not exists group_key text;

alter table public.inventory_receipts
  add column if not exists delivery_date date;

-- 供應商留在商品明細，不進貨單分組 key。
alter table public.inventory_receipt_items
  add column if not exists supplier_code text,
  add column if not exists supplier_name text,
  add column if not exists source_type text,
  add column if not exists source_ref text;

alter table public.logistics_order_items
  add column if not exists supplier_code text,
  add column if not exists supplier_name text;

create index if not exists idx_logistics_batches_group_lookup
  on public.logistics_batches(store_code,delivery_date,delivery_type,delivery_run,status);

create index if not exists idx_inventory_receipt_items_source
  on public.inventory_receipt_items(receipt_id,source_type,source_ref);

-- 以 registry 管理「同一天 + 同溫層 + 同配次」的唯一待處理貨單。
create table if not exists public.yijia_logistics_group_registry (
  group_key text primary key,
  store_code text not null,
  delivery_date date not null,
  delivery_type text not null,
  delivery_run text not null default 'DEFAULT',
  batch_id uuid not null,
  batch_no text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_yijia_logistics_group_registry_batch
  on public.yijia_logistics_group_registry(batch_no);

alter table public.yijia_logistics_group_registry enable row level security;

drop policy if exists yijia_logistics_group_registry_read on public.yijia_logistics_group_registry;
create policy yijia_logistics_group_registry_read
on public.yijia_logistics_group_registry
for select to authenticated
using (true);

grant select on public.yijia_logistics_group_registry to authenticated;

create or replace function public.yijia_normalize_logistics_type(p_type text)
returns text
language sql
immutable
as $$
  select case trim(coalesce(p_type,''))
    when '常溫' then 'ambient'
    when '鮮食一配' then 'fresh_1'
    when '鮮食二配' then 'fresh_2'
    when '乳品' then 'dairy'
    when '低溫一配' then 'dairy'
    when '低溫二配' then 'low_2'
    when '冷凍' then 'frozen'
    when '億家通' then 'yijiatong'
    when 'EC' then 'ec'
    else lower(trim(coalesce(p_type,'')))
  end
$$;

create or replace function public.yijia_logistics_group_key(
  p_store_code text,
  p_delivery_date date,
  p_delivery_type text,
  p_delivery_run text default 'DEFAULT'
)
returns text
language sql
immutable
as $$
  select lower(
    coalesce(nullif(trim(p_store_code),''),'001') || '|' ||
    to_char(p_delivery_date,'YYYY-MM-DD') || '|' ||
    public.yijia_normalize_logistics_type(p_delivery_type) || '|' ||
    coalesce(nullif(trim(p_delivery_run),''),'DEFAULT')
  )
$$;

-- 取得/建立統一貨單。
-- source / external_ref 只作追蹤資訊，不參與 group key。
create or replace function public.yijia_get_or_create_logistics_group(
  p_delivery_type text,
  p_delivery_date date,
  p_delivery_run text default 'DEFAULT',
  p_source text default 'backend',
  p_external_ref text default null,
  p_notes text default null,
  p_store_code text default '001'
)
returns table(
  id uuid,
  batch_no text,
  delivery_type text,
  source text,
  external_ref text,
  status text,
  store_code text,
  delivery_date date,
  delivery_run text,
  group_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_store text := coalesce(nullif(trim(p_store_code),''),'001');
  v_type text := public.yijia_normalize_logistics_type(p_delivery_type);
  v_date date := coalesce(p_delivery_date,(now() at time zone 'Asia/Taipei')::date);
  v_run text := coalesce(nullif(trim(p_delivery_run),''),'DEFAULT');
  v_key text;
  v_reg public.yijia_logistics_group_registry%rowtype;
  v_batch public.logistics_batches%rowtype;
  v_no text;
begin
  if v_type='' then raise exception '物流溫層不可空白'; end if;
  v_key := public.yijia_logistics_group_key(v_store,v_date,v_type,v_run);

  perform pg_advisory_xact_lock(hashtext(v_key));

  select * into v_reg
  from public.yijia_logistics_group_registry r
  where r.group_key=v_key
  for update;

  if found then
    select * into v_batch
    from public.logistics_batches b
    where b.id=v_reg.batch_id
      and b.batch_no=v_reg.batch_no
    limit 1;

    -- 已完成驗收的貨單不能再塞新商品；同 key 後到資料會開新實體批次。
    if found and not exists (
      select 1
      from public.inventory_receipts ir
      where (ir.batch_id=v_batch.id or ir.batch_no=v_batch.batch_no)
        and (
          ir.accepted_at is not null
          or lower(coalesce(ir.status,'')) in ('accepted','completed','received')
        )
    ) and lower(coalesce(v_batch.status,'pending')) not in ('completed','received','accepted','cancelled','closed') then
      update public.logistics_batches
      set delivery_date=v_date,
          delivery_run=v_run,
          group_key=v_key,
          notes=case when nullif(trim(p_notes),'') is null then notes else coalesce(notes||E'\n','')||trim(p_notes) end
      where logistics_batches.id=v_batch.id;

      return query
      select b.id,b.batch_no,b.delivery_type,b.source,b.external_ref,b.status,b.store_code,
             b.delivery_date,coalesce(nullif(b.delivery_run,''),'DEFAULT'),b.group_key,b.created_at
      from public.logistics_batches b where b.id=v_batch.id;
      return;
    end if;

    delete from public.yijia_logistics_group_registry where group_key=v_key;
  end if;

  v_no := 'YJB'||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISSMS');

  insert into public.logistics_batches(
    batch_no,delivery_type,source,external_ref,notes,status,store_code,delivery_date,delivery_run,group_key
  ) values(
    v_no,v_type,coalesce(nullif(trim(p_source),''),'backend'),nullif(trim(p_external_ref),''),
    nullif(trim(p_notes),''),'pending',v_store,v_date,v_run,v_key
  ) returning * into v_batch;

  insert into public.yijia_logistics_group_registry(
    group_key,store_code,delivery_date,delivery_type,delivery_run,batch_id,batch_no,updated_at
  ) values(
    v_key,v_store,v_date,v_type,v_run,v_batch.id,v_batch.batch_no,now()
  )
  on conflict(group_key) do update set
    batch_id=excluded.batch_id,batch_no=excluded.batch_no,updated_at=now();

  return query
  select b.id,b.batch_no,b.delivery_type,b.source,b.external_ref,b.status,b.store_code,
         b.delivery_date,coalesce(nullif(b.delivery_run,''),'DEFAULT'),b.group_key,b.created_at
  from public.logistics_batches b where b.id=v_batch.id;
end;
$$;

-- SC 人工 / EC / 其他來源：同樣走統一分組。
create or replace function public.admin_create_logistics_batch_grouped(
  p_delivery_type text,
  p_delivery_date text default '',
  p_delivery_run text default 'DEFAULT',
  p_source text default 'backend',
  p_external_ref text default null,
  p_notes text default null,
  p_store_code text default '001'
)
returns table(
  id uuid,
  batch_no text,
  delivery_type text,
  source text,
  external_ref text,
  status text,
  store_code text,
  delivery_date date,
  delivery_run text,
  group_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare v_date date;
begin
  v_date := coalesce(nullif(trim(p_delivery_date),'')::date,(now() at time zone 'Asia/Taipei')::date);
  return query
  select * from public.yijia_get_or_create_logistics_group(
    p_delivery_type,v_date,p_delivery_run,p_source,p_external_ref,p_notes,p_store_code
  );
end;
$$;

-- 一般訂購 / FOS / 台帳 / 億家通 / 其他訂購來源。
-- 前端送入的是同 group 的合併商品清單；供應商只保留在 item。
create or replace function public.pos_transmit_order_to_logistics_grouped(
  p_order_no text,
  p_order_type text,
  p_delivery_type text,
  p_delivery_date text,
  p_delivery_run text,
  p_note text,
  p_items jsonb,
  p_store_code text default '001',
  p_operator text default ''
)
returns table(
  order_no text,
  batch_no text,
  delivery_type text,
  status text,
  store_code text,
  transmitted_at timestamptz,
  receipt_no text,
  receipt_barcode text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_store text := coalesce(nullif(trim(p_store_code),''),'001');
  v_type text := public.yijia_normalize_logistics_type(p_delivery_type);
  v_date date := coalesce(nullif(trim(p_delivery_date),'')::date,(now() at time zone 'Asia/Taipei')::date);
  v_run text := coalesce(nullif(trim(p_delivery_run),''),'DEFAULT');
  v_group record;
  v_link_id uuid;
  v_receipt_id uuid;
  v_receipt_no text;
  v_receipt_barcode text;
  v_item jsonb;
  v_now timestamptz := now();
  v_supplier_code text;
  v_supplier_name text;
begin
  if nullif(trim(p_order_no),'') is null then raise exception '訂購群組編號不可空白'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception '商品明細格式錯誤'; end if;

  select * into v_group
  from public.yijia_get_or_create_logistics_group(
    v_type,v_date,v_run,'ordering',trim(p_order_no),nullif(trim(p_note),''),v_store
  );

  select l.id into v_link_id
  from public.logistics_order_links l
  where l.order_no=trim(p_order_no)
  limit 1;

  if v_link_id is null then
    insert into public.logistics_order_links(
      order_no,batch_id,batch_no,store_code,delivery_type,order_type,delivery_date,
      note,status,transmitted_by,transmitted_at,updated_at
    ) values(
      trim(p_order_no),v_group.id,v_group.batch_no,v_store,v_type,nullif(trim(p_order_type),''),v_date,
      nullif(trim(p_note),''),'transmitted',nullif(trim(p_operator),''),v_now,v_now
    ) returning id into v_link_id;
  else
    update public.logistics_order_links
    set batch_id=v_group.id,batch_no=v_group.batch_no,store_code=v_store,delivery_type=v_type,
        order_type=nullif(trim(p_order_type),''),delivery_date=v_date,note=nullif(trim(p_note),''),
        status='transmitted',transmitted_by=nullif(trim(p_operator),''),transmitted_at=v_now,updated_at=v_now
    where id=v_link_id;

    delete from public.logistics_order_items where order_link_id=v_link_id;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_supplier_code := coalesce(nullif(v_item->>'supplierCode',''),nullif(v_item->>'supplier_code',''),nullif(v_item->>'vendorCode',''),nullif(v_item->>'vendor_code',''),nullif(v_item->>'supplierId',''),nullif(v_item->>'vendorId',''));
    v_supplier_name := coalesce(nullif(v_item->>'supplierName',''),nullif(v_item->>'supplier_name',''),nullif(v_item->>'vendorName',''),nullif(v_item->>'vendor_name',''),nullif(v_item->>'supplier',''),nullif(v_item->>'vendor',''));

    insert into public.logistics_order_items(
      order_link_id,order_no,product_id,product_code,barcode,product_name,
      group_name,category,item_delivery_type,qty,supplier_code,supplier_name
    ) values(
      v_link_id,trim(p_order_no),nullif(v_item->>'productId',''),nullif(v_item->>'code',''),
      nullif(v_item->>'barcode',''),coalesce(nullif(v_item->>'name',''),'未命名商品'),
      nullif(v_item->>'group',''),nullif(v_item->>'category',''),
      coalesce(nullif(v_item->>'deliveryType',''),v_type),greatest(0,coalesce(nullif(v_item->>'qty','')::numeric,0)),
      v_supplier_code,v_supplier_name
    );
  end loop;

  -- 一個物流貨單只建立一張待驗收進貨單。
  select r.id,r.receipt_no,r.receipt_barcode into v_receipt_id,v_receipt_no,v_receipt_barcode
  from public.inventory_receipts r
  where r.batch_id=v_group.id or r.batch_no=v_group.batch_no
  order by r.created_at asc
  limit 1;

  if v_receipt_id is null then
    v_receipt_no := 'YJIN'||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISSMS');
    v_receipt_barcode := v_receipt_no;
    insert into public.inventory_receipts(
      receipt_no,receipt_barcode,batch_id,batch_no,order_no,store_code,delivery_type,delivery_date,status
    ) values(
      v_receipt_no,v_receipt_barcode,v_group.id,v_group.batch_no,trim(p_order_no),v_store,v_type,v_date,'expected'
    ) returning id into v_receipt_id;
  else
    update public.inventory_receipts
    set delivery_date=v_date
    where id=v_receipt_id;
  end if;

  -- 只重建「這個 ordering group」的明細；其他來源在同貨單內的明細不受影響。
  delete from public.inventory_receipt_items
  where receipt_id=v_receipt_id and source_type='ordering' and source_ref=trim(p_order_no);

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_supplier_code := coalesce(nullif(v_item->>'supplierCode',''),nullif(v_item->>'supplier_code',''),nullif(v_item->>'vendorCode',''),nullif(v_item->>'vendor_code',''),nullif(v_item->>'supplierId',''),nullif(v_item->>'vendorId',''));
    v_supplier_name := coalesce(nullif(v_item->>'supplierName',''),nullif(v_item->>'supplier_name',''),nullif(v_item->>'vendorName',''),nullif(v_item->>'vendor_name',''),nullif(v_item->>'supplier',''),nullif(v_item->>'vendor',''));

    insert into public.inventory_receipt_items(
      receipt_id,product_id,product_code,barcode,product_name,qty,
      supplier_code,supplier_name,source_type,source_ref
    ) values(
      v_receipt_id,nullif(v_item->>'productId',''),nullif(v_item->>'code',''),nullif(v_item->>'barcode',''),
      coalesce(nullif(v_item->>'name',''),'未命名商品'),greatest(0,coalesce(nullif(v_item->>'qty','')::numeric,0)),
      v_supplier_code,v_supplier_name,'ordering',trim(p_order_no)
    );
  end loop;

  return query
  select trim(p_order_no),v_group.batch_no,
    case v_type when 'ambient' then '常溫' when 'fresh_1' then '鮮食一配' when 'fresh_2' then '鮮食二配'
      when 'dairy' then '低溫一配' when 'low_2' then '低溫二配' when 'frozen' then '冷凍'
      when 'yijiatong' then '億家通' when 'ec' then 'EC' else v_type end,
    'transmitted'::text,v_store,v_now,v_receipt_no,v_receipt_barcode;
end;
$$;

-- 活動自動到店：活動/供應商不拆貨單；依到貨日+溫層+配次歸併。
create or replace function public.admin_create_promotion_auto_arrival_grouped(
  p_activity_name text,
  p_delivery_type text,
  p_delivery_date text,
  p_delivery_run text,
  p_external_ref text,
  p_notes text,
  p_product_id text default null,
  p_product_code text default null,
  p_barcode text default null,
  p_product_name text default '',
  p_supplier_code text default '',
  p_supplier_name text default '',
  p_qty numeric default 0,
  p_store_code text default '001',
  p_operator text default ''
)
returns table(
  batch_no text,
  receipt_no text,
  delivery_type text,
  status text,
  store_code text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_store text := coalesce(nullif(trim(p_store_code),''),'001');
  v_type text := public.yijia_normalize_logistics_type(p_delivery_type);
  v_date date := coalesce(nullif(trim(p_delivery_date),'')::date,(now() at time zone 'Asia/Taipei')::date);
  v_run text := coalesce(nullif(trim(p_delivery_run),''),'DEFAULT');
  v_group record;
  v_receipt_id uuid;
  v_receipt_no text;
  v_receipt_barcode text;
  v_item_id uuid;
  v_qty numeric := greatest(0,coalesce(p_qty,0));
  v_source_ref text := coalesce(nullif(trim(p_external_ref),''),nullif(trim(p_activity_name),''),'promotion_auto_arrival');
begin
  if v_qty<=0 then raise exception '活動商品到店數量必須大於 0'; end if;

  select * into v_group
  from public.yijia_get_or_create_logistics_group(
    v_type,v_date,v_run,'promotion_auto_arrival',p_external_ref,p_notes,v_store
  );

  select r.id,r.receipt_no,r.receipt_barcode into v_receipt_id,v_receipt_no,v_receipt_barcode
  from public.inventory_receipts r
  where r.batch_id=v_group.id or r.batch_no=v_group.batch_no
  order by r.created_at asc limit 1;

  if v_receipt_id is null then
    v_receipt_no := 'YJIN'||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYMMDDHH24MISSMS');
    v_receipt_barcode := v_receipt_no;
    insert into public.inventory_receipts(
      receipt_no,receipt_barcode,batch_id,batch_no,order_no,store_code,delivery_type,delivery_date,status
    ) values(
      v_receipt_no,v_receipt_barcode,v_group.id,v_group.batch_no,null,v_store,v_type,v_date,'expected'
    ) returning id into v_receipt_id;
  end if;

  select i.id into v_item_id
  from public.inventory_receipt_items i
  where i.receipt_id=v_receipt_id
    and coalesce(i.source_type,'')='promotion_auto_arrival'
    and coalesce(i.source_ref,'')=v_source_ref
    and coalesce(i.supplier_code,'')=coalesce(trim(p_supplier_code),'')
    and coalesce(i.supplier_name,'')=coalesce(trim(p_supplier_name),'')
    and (
      (nullif(trim(p_product_code),'') is not null and i.product_code=trim(p_product_code))
      or (nullif(trim(p_barcode),'') is not null and i.barcode=trim(p_barcode))
      or (nullif(trim(p_product_name),'') is not null and i.product_name=trim(p_product_name))
    )
  limit 1;

  if v_item_id is null then
    insert into public.inventory_receipt_items(
      receipt_id,product_id,product_code,barcode,product_name,qty,
      supplier_code,supplier_name,source_type,source_ref
    ) values(
      v_receipt_id,nullif(trim(p_product_id),''),nullif(trim(p_product_code),''),nullif(trim(p_barcode),''),
      coalesce(nullif(trim(p_product_name),''),'未命名商品'),v_qty,
      nullif(trim(p_supplier_code),''),nullif(trim(p_supplier_name),''),'promotion_auto_arrival',v_source_ref
    );
  else
    update public.inventory_receipt_items
    set product_id=coalesce(nullif(trim(p_product_id),''),product_id),
        product_code=coalesce(nullif(trim(p_product_code),''),product_code),
        barcode=coalesce(nullif(trim(p_barcode),''),barcode),
        product_name=coalesce(nullif(trim(p_product_name),''),product_name),
        qty=v_qty,
        supplier_code=nullif(trim(p_supplier_code),''),
        supplier_name=nullif(trim(p_supplier_name),'')
    where id=v_item_id;
  end if;

  return query
  select v_group.batch_no,v_receipt_no,
    case v_type when 'ambient' then '常溫' when 'fresh_1' then '鮮食一配' when 'fresh_2' then '鮮食二配'
      when 'dairy' then '低溫一配' when 'low_2' then '低溫二配' when 'frozen' then '冷凍'
      when 'yijiatong' then '億家通' when 'ec' then 'EC' else v_type end,
    'expected'::text,v_store;
end;
$$;

revoke all on function public.yijia_get_or_create_logistics_group(text,date,text,text,text,text,text) from public;
revoke all on function public.admin_create_logistics_batch_grouped(text,text,text,text,text,text,text) from public;
revoke all on function public.pos_transmit_order_to_logistics_grouped(text,text,text,text,text,text,jsonb,text,text) from public;
revoke all on function public.admin_create_promotion_auto_arrival_grouped(text,text,text,text,text,text,text,text,text,text,text,text,numeric,text,text) from public;

grant execute on function public.admin_create_logistics_batch_grouped(text,text,text,text,text,text,text) to authenticated,anon;
grant execute on function public.pos_transmit_order_to_logistics_grouped(text,text,text,text,text,text,jsonb,text,text) to authenticated,anon;
grant execute on function public.admin_create_promotion_auto_arrival_grouped(text,text,text,text,text,text,text,text,text,text,text,text,numeric,text,text) to authenticated,anon;

notify pgrst,'reload schema';
commit;
