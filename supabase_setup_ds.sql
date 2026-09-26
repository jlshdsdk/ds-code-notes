-- ================================================================
--  数据结构代码笔记 · 云同步一键初始化脚本
--
--  使用方法：
--   1. 打开 Supabase 控制台 → 左侧「SQL Editor」→ New query
--   2. 全选复制本文件全部内容 → 粘贴 → 点「Run」，显示 Success 即完成
--
--  说明：
--   · 依赖词汇站 supabase_setup.sql 已建立的 profiles / app_config /
--     is_admin() 体系（本仓库与词汇站共用同一个 Supabase 项目与账号），
--     用 admin_email 登记邮箱注册的账号自动成为管理员。
--   · 本脚本可重复运行，不会破坏已有数据。
-- ================================================================

-- ---------- 数据表（全部加 ds_ 前缀，与词汇站隔离） ----------

-- 三级目录树：L1/L2 目录 + L3 文档节点
create table if not exists public.ds_nodes (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  parent_id  uuid,                          -- null=根节点；层级合法性由应用层保证
  name       text not null,
  kind       text not null check (kind in ('dir','doc')),
  sort_order double precision not null default 1024,
  updated_at timestamptz not null default now()
);
create index if not exists ds_nodes_user_idx on public.ds_nodes(user_id);

-- 笔记 HTML（每个文档节点一行，目录删除时级联删除）
create table if not exists public.ds_notes (
  doc_id     uuid primary key references public.ds_nodes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  html       text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists ds_notes_user_idx on public.ds_notes(user_id);

-- 代码（每个文档节点一行）
create table if not exists public.ds_code (
  doc_id     uuid primary key references public.ds_nodes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  code       text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists ds_code_user_idx on public.ds_code(user_id);

-- 删除墓碑：把删除动作同步到其他设备
create table if not exists public.ds_tombstones (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now()
);
create index if not exists ds_tombstones_user_idx on public.ds_tombstones(user_id);

-- ---------- updated_at 自动维护 ----------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- insert/update 都用服务器时钟，杜绝客户端时钟参与 LWW 比较
drop trigger if exists trg_ds_nodes_touch on public.ds_nodes;
create trigger trg_ds_nodes_touch before insert or update on public.ds_nodes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_ds_notes_touch on public.ds_notes;
create trigger trg_ds_notes_touch before insert or update on public.ds_notes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_ds_code_touch on public.ds_code;
create trigger trg_ds_code_touch before insert or update on public.ds_code
  for each row execute function public.touch_updated_at();

-- ---------- 行级安全：每个用户只能读写自己的行 ----------

alter table public.ds_nodes enable row level security;
alter table public.ds_notes enable row level security;
alter table public.ds_code enable row level security;
alter table public.ds_tombstones enable row level security;

drop policy if exists ds_nodes_all on public.ds_nodes;
create policy ds_nodes_all on public.ds_nodes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ds_notes_all on public.ds_notes;
create policy ds_notes_all on public.ds_notes for all
  using (
    user_id = auth.uid()
    and doc_id in (select id from public.ds_nodes where user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and doc_id in (select id from public.ds_nodes where user_id = auth.uid())
  );

drop policy if exists ds_code_all on public.ds_code;
create policy ds_code_all on public.ds_code for all
  using (
    user_id = auth.uid()
    and doc_id in (select id from public.ds_nodes where user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and doc_id in (select id from public.ds_nodes where user_id = auth.uid())
  );

drop policy if exists ds_tombstones_all on public.ds_tombstones;
create policy ds_tombstones_all on public.ds_tombstones for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 图片存储桶（私有，路径 <user_id>/<doc_id>/<img_id> 隔离） ----------

insert into storage.buckets (id, name, public)
values ('ds-images', 'ds-images', false)
on conflict (id) do nothing;

drop policy if exists "ds-img-select" on storage.objects;
create policy "ds-img-select" on storage.objects for select
  using (bucket_id = 'ds-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ds-img-insert" on storage.objects;
create policy "ds-img-insert" on storage.objects for insert
  with check (bucket_id = 'ds-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ds-img-update" on storage.objects;
create policy "ds-img-update" on storage.objects for update
  using (bucket_id = 'ds-images' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'ds-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ds-img-delete" on storage.objects;
create policy "ds-img-delete" on storage.objects for delete
  using (bucket_id = 'ds-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------- 完成 ----------
-- 管理员能力：显式钉死 profiles 的读写策略（幂等覆盖，不依赖另一仓库的配置）：
-- 普通用户只能读自己的档案，读全员/改/禁用一律要求 is_admin()
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
