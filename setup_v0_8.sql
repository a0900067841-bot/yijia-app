-- 億家 App v0.8：App 僅讀取總部 SC 公開設定
grant select on table public.yijia_app_state to authenticated;

alter table public.yijia_app_state enable row level security;

drop policy if exists "yijia_app_state_app_public_read" on public.yijia_app_state;

create policy "yijia_app_state_app_public_read"
on public.yijia_app_state
for select
to authenticated
using (
  store_id = '001'
  and data_key in ('yj_hq_app_settings','yj_app_coupons','yj_app_anybuy_products')
);
