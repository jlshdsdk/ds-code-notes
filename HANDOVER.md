# HANDOVER.md — ds-code-notes 交接文档

> 本文档面向接手本项目的 AI 代理（harness）或人类开发者，目标是**只读这一份就能继续开发/排障/部署**。
> 配套断点文件：`PLAN.md`（计划）、`PROGRESS.md`（执行日志）。接手顺序：本文 → PLAN → PROGRESS。

---

## 1. 项目是什么

「数据结构 C++ 代码笔记」网站：三级目录组织知识点，每个三级节点 = 富文本笔记 + 可在线编译运行的 C++ 代码。

| 项 | 值 |
|---|---|
| 线上地址 | https://jlshdsdk.github.io/ds-code-notes/ |
| GitHub 仓库 | https://github.com/jlshdsdk/ds-code-notes（main 分支推送即自动部署） |
| 本地路径（原开发机） | `C:\Users\王奕博\.zcode\workspace\default\ds-code-notes` |
| 所有者 | GitHub 账号 jlshdsdk（用户：王奕博，邮箱 3667656609@qq.com，**全站唯一账号+管理员**） |

## 2. 技术栈与关键版本

- **构建**：Vite 6 + TypeScript 5.8（`strict`，`npm run typecheck`）
- **UI**：Preact 10 + `@preact/signals`（响应式）+ `preact/compat` 的 `lazy/Suspense` 做懒加载
- **代码编辑器**：CodeMirror 6（`@codemirror/lang-cpp` + classHighlighter）。**禁止 Monaco**（体积）
- **富文本**：TipTap 2.27（StarterKit 已关闭 heading、无 Link；自定义扩展见 §5）
- **本地存储**：IndexedDB，经 `idb` 8 封装（`src/lib/db.ts`）
- **云端**：Supabase JS v2（Auth 邮箱密码 + Postgres + Storage）
- **部署**：GitHub Actions → GitHub Pages（`.github/workflows/deploy.yml`，Pages 源=GitHub Actions 模式）
- **Service Worker**：`public/sw.js`，导航 network-first / 带哈希资源 cache-first / 跨域请求不拦截

## 3. 与考研词汇站共享的 Supabase 项目（重要）

本站与 https://jlshdsdk.github.io/kaoyan-vocab5/ **共用同一个 Supabase 项目和账号体系**：

- Project URL：`https://qvemohfojzawpnleyjsb.supabase.co`
- anon key（公开，写在前端 `src/lib/supabase.ts`）：`sb_publishable_VFalDAdNoIgd19oxlZ8wlw_AM-rv7Uq`
- 共用表：`profiles`（含 is_admin/banned）、`app_config`（admin_email）、`is_admin()` 函数——由词汇站的 `supabase_setup.sql` 建立
- 本站专属表（`ds_` 前缀）由**本仓库根的 `supabase_setup_ds.sql`** 建立（可重复执行）。**该 SQL 已在 2026-09-27 替用户执行过，勿重复执行也无妨**
- 管理员判定：`app_config.admin_email` 登记的邮箱注册自动 is_admin；其他邮箱提权走 `update public.profiles set is_admin=true where email='...'`

## 4. 云端数据模型（supabase_setup_ds.sql）

```
ds_nodes(id PK, user_id, parent_id→ds_nodes.id?, name, kind∈{dir,doc}, sort_order float, updated_at)
ds_notes(doc_id PK → ds_nodes.id ON DELETE CASCADE, user_id, html, updated_at)
ds_code (doc_id PK → ds_nodes.id ON DELETE CASCADE, user_id, code, updated_at)
ds_tombstones(id PK, user_id, deleted_at)          -- 删除墓碑
storage bucket: ds-images（私有），路径 <user_id>/<doc_id>/<img_id>
```

关键约束（改动前务必理解）：

- **RLS**：四张表均 `user_id = auth.uid()`；ds_notes/ds_code 额外校验 `doc_id` 归属（防占位行 DoS）；profiles 显式钉死 select=本人或管理员、update=管理员
- **统一时钟**：三张数据表的 `trg_*_touch` trigger 覆盖 **insert 或 update**，updated_at 一律服务器 now()。**LWW 的比较基准是服务器时钟**，客户端时钟不参与（历史上因此丢过数据，勿回退）
- stdin 输入框内容按文档存在 IndexedDB `meta` 表（`stdin:<docId>`），**不**上云

## 5. 前端架构（src/）

```
main.tsx            入口 + SW 注册（仅 PROD）
App.tsx             启动序：先本地渲染秒开 → 后台 initAuth() 云端接管
state.ts            全局 signals：nodes Map / currentDocId / settings / UI持久化(localStorage: ds-ui-doc/tab/expanded)
lib/db.ts           IndexedDB 封装 + activeScope(local|userId) + dirtyHook 挂点
lib/sync.ts         同步引擎（§6）
lib/compile.ts      Wandbox 编译适配层（§7）
lib/cm.ts           CodeMirror 装配（VS Light 主题，CSS 变量配色）
lib/tree.ts         目录树规则：根下只能 L1 目录；L1 下只能 L2 目录；L2 下只能 doc；
                    planAdjacentMove 处理拖拽排序（中点法+精度耗尽重排）
lib/images.ts       图片压缩（最长边1600px/JPEG≤1MB）+ objectURL 缓存
lib/highlight.ts    lezer 高亮 → tok-* class HTML（笔记内代码片段与编辑器共用配色）
lib/search.ts       全文搜索（标题/笔记/代码，线性扫，内存中 stripHtml）
components/Sidebar  目录树 UI：增删改名/拖拽(modeFor: 上25%前插/下25%后插/中间放入)/二次确认删除
components/DocPane  「笔记｜代码」双页签（懒加载两个编辑器）
components/NoteEditor  TipTap：DsTextStyle(字号/字体)+Color+DsImage(blob引用 img[data-img-id])+CppSnippet(atom 高亮块)
                      +格式刷(brushState/captureFormat/250ms 防抖) + 工具栏(keepFocus 防失焦)
components/CodeEditor  CodeMirror + 运行面板（stdin 持久化、离线置灰、三类错误展示）
components/TopBar   搜索框/同步角标(点击=forceFullPull)/管理员入口/登录弹窗
styles.css          全部样式；--ds-comment-color/--ds-editor-bg 全局配色变量
scripts/acceptance.mjs  编译后端 11 用例验收（8 个 DS 程序 + 3 个错误分类）
```

## 6. 同步引擎设计（lib/sync.ts，改动最需谨慎的文件）

**local-first**：一切写操作先落本设备 IndexedDB（库 `ds-notes--<scope>`，scope=local 或 userId），经 `db.ts` 的 markDirty → 脏集合 → **1.5s 防抖 pushNow**。拉取时机：登录后、window focus、每 90s、每次 push 成功后 800ms。

- **pushNow**：互斥（pushBusy）；upsert ds_nodes/notes/code + Storage 上传图片 + 删除时 DELETE + 墓碑 upsert + 尽力清理存储桶图片；失败回灌脏集合 5s 重试；`uninit`（表没建）不空转重试
- **pullNow**：与 push 互斥；`selectSince` 分页（每页 1000，防默认行数截断）；**墓碑先行**删除；LWW 合并（`local.updatedAt < 远端时间` 才覆盖）；**本地脏行跳过远端覆盖**（未推送修改优先）；`lastPullAt` 记录**远端行的最大服务器时间**（防客户端快钟漏拉）
- **adoptScope**（登录/换账号）：setScope → 空树则清游标 → 先 pullNow 拉平云端 → 再把 guest 库（local scope）数据 LWW 合并进用户库（+2s 容差）→ 只把真正写入的行标脏推送
- **forceFullPull**：同步角标点击 = lastPullAt=0 + pullNow，用户侧"一键对齐云端"保险
- **认证事件**：SIGNED_IN 同用户重复触发（令牌刷新/回焦）**直接忽略**；SIGNED_OUT 先 `getSession()` 核实真掉线才切回 local。**绝不 location.reload()**（曾导致切页白屏，勿回退）
- 关页/切走：visibilitychange(hidden) 时 flush 编辑器 + pushNow

**已知边界**：两设备同时编辑同一篇笔记 = 后保存者赢（LWW，行级粒度）；无实时推送（如需秒级同步可加 Supabase Realtime 订阅触发 pullNow）。

## 7. 编译后端（lib/compile.ts）

- **主后端 Wandbox** `gcc-13.2.0`，`options: 'warning,gnu++17'`，30s 服务端杀死死循环 → 客户端超时 45s
- **历史结论**：Piston 公共 API 2026-02 起白名单制 401 不可用；Coliru stdin 不进程序；**不要用 wasm 编译器**（用户要求"正确代码绝不误报"，JS 方案做不到）
- **错误三分类**（用户的核心验收标准）：
  1. `network`：fetch 失败/HTTP 非 200/JSON 解析失败 → 文案明确"网络问题请重试"，**绝不显示"编译失败"**；429 单独文案
  2. `compile`：诊断含 `error:`（**纯 warning 不算**！-Wall 下学生代码常见 warning+段错误，曾因此误判）；原样展示 GCC 输出
  3. `runtime`：status 128+n 信号解码（137=疑似死循环 / 139=段错误 / 134=abort / **132=漏写 return 的 SIGILL，学生会高频踩**）
- 特殊坑：输出 ≥131072 字节时 Wandbox **截断且 status 为空串**（归一为正常退出 + 显示截断提示）
- 验收：`node scripts/acceptance.mjs` 须 11/11 通过（需联网）
- **提速设计**（2026-09-28 加入）：`runCpp` 带 LRU 结果缓存（键=后端+代码+stdin，容量 30，网络错误不缓存），重复运行相同代码+输入秒出；`index.html` 对 wandbox.org 的 preconnect 必须带 `crossorigin`（跨域 fetch 复用的是 CORS 连接，不带则预热无效）；服务器端编译耗时 2.5–3.2s 是物理下限，除非改编译器/去警告（会改变行为，勿动）

## 8. 用户确认的产品决策（勿擅自更改）

- 目录三级：L1/L2 只是容器，**L3(doc) 才有内容**；均可增删改名拖拽（跨层级有合法性校验）
- 节点内「笔记｜代码」页签切换，**不做分屏**；代码单文件
- 笔记字体颜色 = **黑/紫/红三个色块快选**（#000000/#7c3aed/#dc2626），不是取色器
- 笔记正文默认 **微软雅黑 16px / 行距 2 倍**（参考用户教材）；heading 已禁用（行距统一）
- 注释色默认灰 #808080、编辑器背景默认白，设置面板改 CSS 变量全站即时生效
- stdin **一次性输入**（在线编译无法交互式输入）；输入框旁保留提示小字（用户明确要求保留）
- 桌面优先，移动端只保证可读；未登录可用全部本地功能
- 开放注册，管理员面板=查看/禁用（复用词汇站 profiles）

## 9. 开发/部署流程

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit，提交前必过
npm run build        # 产物 dist/（vite base=/ds-code-notes/，勿改）
node scripts/acceptance.mjs   # 编译验收 11/11
```

部署 = `git push origin main` → Actions 自动 typecheck+build+deploy 到 Pages（约 100 秒）。线上验证：`curl -s https://jlshdsdk.github.io/ds-code-notes/` 返回 HTML 200。

**原开发机网络特征**（换机器可忽略）：GitHub 直连间歇不可用，push 失败走镜像 `git push https://gh-proxy.com/https://github.com/jlshdsdk/ds-code-notes.git main`；无 gh CLI，API 用 `git credential fill` 取凭据管理器里的 token。

## 10. 已知残留事项（接手先看）

1. **无自动化 UI 测试**：历次验证靠 ZCode 内置浏览器（IAB）人工/半自动冒烟。IAB 有两个怪癖曾浪费大量时间：无 OS 焦点时真实按键被丢弃；窗口切换后首个真实点击可能被吞。**测试用页面内事件派发（dispatchEvent）或 API 层调用最稳**
2. 格式刷的"刷"半程依赖真实选区交互，自动化只验证到分段；逻辑见 NoteEditor.tsx 的 brushState/captureFormat/transaction 监听
3. 墓碑表无 GC（量小可接受）；笔记内删图片不做 ImageRow 回收（孤儿图片占存储，低优先级）
4. 搜索是打开面板时线性扫本设备 IndexedDB（个人数据量级足够；数据量大了再考虑索引）
5. ds_nodes 的 sort_order 中点法在 ~50 次同位插入后触发整组重排（已实现，自愈）

## 11. 排障速查

| 症状 | 首查 |
|---|---|
| 别的设备登录后目录空 | 让用户点右上角 ☁️（forceFullPull）；仍空查该设备能否访问 *.supabase.co |
| 顶栏「🗄️ 云未初始化」 | ds_* 表没建：在 Supabase SQL Editor 跑 supabase_setup_ds.sql |
| 顶栏「⚠️ 离线」 | 网络/Supabase 不可达；浏览器控制台看具体请求 |
| 用户代码输出乱数字 | 多为 cin 没读到输入（输入框空/全角数字/输入不足），非编译器问题 |
| 运行无输出+退出码 132 | 学生代码漏写 return（SIGILL），提示补 return true |
| 改了代码线上没变 | Actions 是否成功；SW 缓存导航是 network-first，正常刷新即可拿到新版 |
