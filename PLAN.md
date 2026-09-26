# PLAN.md — ds-code-notes 断点计划

> 任何模型接手先读本文件 + PROGRESS.md 再续作。规格全文见会话或 README。

## 规格 TL;DR
数据结构 C++ 代码笔记网站。Vite+TS+Preact / CodeMirror 6（禁 Monaco）/ TipTap 富文本 /
IndexedDB local-first / Supabase(Auth+Postgres+Storage，复用词汇站同项目，新表 ds_ 前缀) /
GitHub Pages（仓库 jlshdsdk/ds-code-notes，凭据在 Windows 凭据管理器，push 需
`-c http.https://github.com.proxy=` 覆盖失效代理）。

关键决策（用户已确认）：
- 目录三级：L1/L2 只是容器，L3(doc) 才有内容；均可增删改名**拖拽**（跨层级有合法性规则）
- 节点内「笔记｜代码」标签页，不分屏；代码单文件
- 笔记：图片（粘贴截图+本地上传，压缩≤1MB，存 IndexedDB blob，html 用 data-img-id 引用）、
  加粗/字号/字色/字体、可插带高亮 C++ 代码片段（atom node + 弹窗编辑）
- 代码外观设置：注释色（默认灰 #808080）、编辑器背景（默认白）——CSS 变量全局生效
- 编译：**Piston 公共 API 已死（2026-02 白名单制 401），主后端=Wandbox gcc-13.2.0（已实测
  stdin/输出正确）**；适配层可切换；错误三分：网络/编译/超时；断网置灰运行按钮
- stdin 一次性输入；输出区 stdout/stderr 分开
- 账号：开放注册，**复用词汇站 profiles 表**（is_admin/banned/admin_email 已存在），
  同一账号两边通用；管理员面板=查看/禁用
- 同步：local-first，按表粒度（nodes/notes/code/images），updated_at LWW，顶栏状态图标
- 搜索：全文搜笔记文字+代码内容（内存线性扫，个人数据量小）
- 设备：桌面优先；移动端只保证能登录能看
- 性能：首屏 gzip≤200KB；CodeMirror/TipTap/编译器动态 import 懒加载；保存防抖 800ms；
  打开节点先读本地缓存
- 每阶段完成后派 censor 子代理对抗性审查（编译误报/XSS/同步丢数据/拖拽边界/RLS 越权）

## 阶段
- [x] P0 环境/建仓/骨架 —— 仓库已建 jlshdsdk/ds-code-notes；Supabase URL+anon key 取自
      kaoyan-vocab5/assets/js/config.js
- [ ] P1 目录树+富文本+编辑器+设置 → censor 审查
- [ ] P2 编译运行（wandbox 适配层+8 用例验收）→ censor 审查
- [ ] P3 注册登录+云同步+搜索+管理员（SQL 交给用户在 Supabase SQL Editor 跑，同词汇站惯例）→ censor 审查
- [ ] P4 GitHub Actions 部署 Pages+性能验收+README+上线

## 环境备忘
- Node v24.15.0 / npm 11.12.1；无 gh CLI，用 git credential fill 拿 token 调 API
- GitHub 直连间歇可用：push 先重试，再 gh-proxy；git 全局代理 127.0.0.1:7892 常不在线
- workspace: C:\Users\王奕博\.zcode\workspace\default\ds-code-notes
