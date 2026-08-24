
-- 億家 App v0.6 安全連線欄位與 RLS
-- 請在 Supabase SQL Editor 執行一次

alter table public.app_members
  add column if not exists auth_user_id uuid unique;

alter table public.app_points
  add column if not exists auth_user_id uuid unique;

alter table public.app_point_transactions
  add column if not exists auth_user_id uuid;

create index if not exists idx_app_members_auth_user_id
  on public.app_members(auth_user_id);

create index if not exists idx_app_points_auth_user_id
  on public.app_points(auth_user_id);

create index if not exists idx_app_point_transactions_auth_user_id
  on public.app_point_transactions(auth_user_id);

alter table public.app_members enable row level security;
alter table public.app_points enable row level security;
alter table public.app_point_transactions enable row level security;

drop policy if exists "app_members_self_select" on public.app_members;
drop policy if exists "app_members_self_insert" on public.app_members;
drop policy if exists "app_members_self_update" on public.app_members;

create policy "app_members_self_select"
on public.app_members for select
to authenticated
using (auth.uid() = auth_user_id);

create policy "app_members_self_insert"
on public.app_members for insert
to authenticated
with check (auth.uid() = auth_user_id);

create policy "app_members_self_update"
on public.app_members for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "app_points_self_select" on public.app_points;
drop policy if exists "app_points_self_insert" on public.app_points;

create policy "app_points_self_select"
on public.app_points for select
to authenticated
using (auth.uid() = auth_user_id);

-- 開發階段讓新會員自動建立 0 點帳戶
create policy "app_points_self_insert"
on public.app_points for insert
to authenticated
with check (auth.uid() = auth_user_id and available_points = 0 and expiring_points = 0);

drop policy if exists "app_point_transactions_self_select" on public.app_point_transactions;

create policy "app_point_transactions_self_select"
on public.app_point_transactions for select
to authenticated
using (auth.uid() = auth_user_id);

-- 注意：App 端不提供新增/修改點數紀錄權限。
-- 之後 TM / SC 後端以安全後端權限寫入點數，避免會員自己加點。
