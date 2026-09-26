# 数据结构代码笔记（ds-code-notes）

数据结构 C++ 学习专用代码笔记网站：三级目录组织知识点，每个知识点 = 富文本笔记 + 可在线编译运行的 C++ 代码，支持云同步与多设备使用。

**线上地址**：https://jlshdsdk.github.io/ds-code-notes/

## 功能

- **三级目录树**：一级/二级只是容器，三级笔记节点真正承载内容；支持增、删、改名、拖拽排序与跨层级移动（合法性自动校验：一级只能在根下、二级只能在一/二级下、文档只能在二级下）
- **笔记区**：富文本编辑，支持加粗、字号、字体颜色、字体 family、插入/粘贴图片（自动压缩 ≤1MB）、插入带语法高亮的 C++ 代码片段（只展示不可运行）
- **代码区**：CodeMirror 6 编辑器，Visual Studio 浅色配色，行号 / 搜索 / 撤销历史；一键在线编译运行（真实 GCC 13.2.0），stdin 一次性输入，stdout/stderr 分色显示
- **外观设置**：注释颜色（默认灰）、编辑器背景（默认白）全站即时生效，笔记内代码片段与编辑器共用一套配色
- **账号系统**：邮箱注册登录，数据按用户隔离（RLS 硬保证）；管理员可查看/禁用账号
- **云同步**：local-first——所有内容先写本地 IndexedDB 秒开，后台静默同步云端；按节点粒度同步，updated_at 最后写入胜出；顶栏常驻同步状态
- **全局搜索**：同时搜标题、笔记正文、代码内容，点击直达
- **防卡顿**：首屏 gzip 约 80KB（预算 200KB），编辑器/富文本/编译器全部按需懒加载

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
npm run typecheck
node scripts/acceptance.mjs   # 编译后端 11 用例验收（需联网）
```

## 云同步开通（Supabase）

本站与 [kaoyan-vocab5](https://github.com/jlshdsdk/kaoyan-vocab5) 共用同一个 Supabase 项目（账号互通）。

1. 若该项目从未初始化过账号体系：先在 Supabase SQL Editor 执行词汇站的 `supabase_setup.sql`
2. 再执行本仓库的 **`supabase_setup_ds.sql`**（建 ds_ 前缀的数据表、RLS 策略、ds-images 私有存储桶）
3. 用 `app_config.admin_email` 里登记的邮箱注册 → 自动成为管理员。
   若要用其他邮箱当管理员：
   ```sql
   update public.profiles set is_admin = true where email = '你的邮箱';
   ```
4. 表结构：`ds_nodes`（目录树）/ `ds_notes`（笔记 HTML）/ `ds_code`（代码）/ `ds_tombstones`（删除墓碑）/ Storage `ds-images` 桶（图片，路径 `<user_id>/<doc_id>/<img_id>`）

## 部署

推送到 `main` 分支后 GitHub Actions 自动构建部署到 Pages（`.github/workflows/deploy.yml`）。Pages 源需为「GitHub Actions」模式。

## 架构备忘

- **技术栈**：Vite + TypeScript + Preact + @preact/signals；CodeMirror 6；TipTap 2；idb；@supabase/supabase-js
- **本地存储**：IndexedDB，库名 `ds-notes--<scope>`（未登录 scope=local，登录后 scope=用户 id，首次登录自动迁移合并 local 数据）
- **同步**：改动先落本地，脏集合防抖 1.5s 推送（upsert + updated_at LWW）；删除用墓碑表同步到其他设备；图片走 Storage 上传/按需下载；失败自动回灌重试
- **编译后端**：Wandbox 公共 API（gcc-13.2.0，`-Wall -Wextra -std=gnu++17`）。Piston 公共 API 已白名单制不可用；适配层可切换（`src/lib/compile.ts`）。错误三分类：网络/超时（绝不显示"编译失败"）、真实编译错误（原样 GCC 诊断）、运行时异常（退出码/信号解码：137 疑似死循环、139 段错误、134 abort）
- **禁用名单**：Monaco（太重）、JS 版 C++ 解释器（不正确）、Coliru（stdin 不进程序）
