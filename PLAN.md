# PLAN.md — ds-code-notes 断点计划

> 任何模型接手先读本文件 + PROGRESS.md 再续作。

## 规格 TL;DR
数据结构 C++ 代码笔记网站。Vite+TS+Preact / CodeMirror 6（禁 Monaco）/ TipTap 富文本 /
IndexedDB local-first / Supabase(Auth+Postgres+Storage，复用词汇站同项目，新表 ds_ 前缀) /
GitHub Pages（仓库 jlshdsdk/ds-code-notes）。

关键决策（用户已确认）：
- 目录三级：L1/L2 只是容器，L3(doc) 才有内容；均可增删改名**拖拽**（合法性规则见 src/lib/tree.ts）
- 节点内「笔记｜代码」标签页，不分屏；代码单文件
- 笔记：图片（粘贴+本地上传，压缩≤1MB，IndexedDB blob，html 用 data-img-id）、加粗/字号/字色/字体、
  高亮 C++ 代码片段（atom node + 弹窗编辑）
- 代码外观：注释色默认灰 #808080、编辑器背景默认白 —— CSS 变量 --ds-comment-color / --ds-editor-bg
- 编译：**Wandbox gcc-13.2.0（Piston 公共 API 已死；Coliru stdin 有坑弃用）**，适配层可切换；
  错误三分类（网络/编译/运行时），编译错误判定=诊断含 `error:`（纯 warning 不算）
- stdin 一次性输入；账号开放注册，admin_email（词汇站 app_config）自动管理员；
  同步 local-first + 墓碑删除 + 服务器统一时钟（touch trigger 覆盖 insert+update）
- 搜索：本地全文（标题/笔记/代码）线性扫

## 阶段（全部完成）
- [x] P0 环境/建仓/骨架
- [x] P1 目录树+富文本+编辑器+设置 → censor 审查（P0×1 P1×3 P2×6 已修）
- [x] P2 编译运行 + 11 用例验收（scripts/acceptance.mjs）→ censor 审查（P0×2 已修）
- [x] P3 账号+云同步+搜索+管理员 → censor 审查（P0×3 P1×6 已修）
- [x] P4 GitHub Actions 部署 Pages + README

## 待办（需要用户动作）
- **用户在 Supabase SQL Editor 执行 supabase_setup_ds.sql** —— 不执行则云同步/管理员面板不可用
  （登录/注册/本地功能不受影响）；执行后管理员的 isAdmin 需要 refreshProfile 或刷新页面

## 环境备忘
- 无 gh CLI：git credential fill 拿 token 调 API；push 直连挂了走
  `git push https://gh-proxy.com/https://github.com/jlshdsdk/ds-code-notes.git main`
- Pages 源=GitHub Actions 模式；部署 URL https://jlshdsdk.github.io/ds-code-notes/
