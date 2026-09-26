# PROGRESS.md — 执行日志（最新在上）

## 2026-09-26 全部完成 ✅ 已上线
- 线上：https://jlshdsdk.github.io/ds-code-notes/（Actions 部署，main 推送自动更新）
- 最终提交 a3f9b10；首屏 gzip ≈83KB（预算 200KB）；懒加载包：CM 共享 134KB / NoteEditor 91.6KB / CodeEditor 16.3KB
- 编译验收 11/11（8 个 DS 程序 + 3 个错误分类用例）
- P3 同步引擎经两轮 censor：返工了时钟双轨（服务器 touch trigger 统一 insert+update）、
  迁移先拉后并、RLS doc_id 归属校验、分页、push/pull 互斥、存储桶图片清理
- **未做**：云同步 E2E（等用户执行 supabase_setup_ds.sql）；注册流程真实跑通（避免留垃圾账号）
- dev 服务器已停（后台 exec_0491715f）

## 2026-09-26 P1/P2/P3 审查与修复（详见 git log）
- P1：拖拽父指针环 P0、删除复活数据、子树深度非法化、跨文档弹窗泄漏、Firefox 拖拽等
- P2：warning 误判编译失败 P0、空 status P0、45s 超时、信号解码、验收脚本补分类用例
- P3：见 PLAN.md 待办

## 2026-09-26 P0
- 环境探测：Node 24/npm 11；无 gh CLI → git credential fill token（repo,workflow scope）
- 编译后端实测：Piston 401 白名单制已死；**Wandbox gcc-13.2.0 OK**；Coliru 弃用
- Supabase 复用词汇站项目（qvemohfojzawpnleyjsb.supabase.co）；建仓 jlshdsdk/ds-code-notes
