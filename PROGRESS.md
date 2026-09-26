# PROGRESS.md — 执行日志（最新在上）

## 2026-09-26 P1 ✅ 完成（待 censor 审查）
- 全部源码：types/db(idb)/tree/settings/images/highlight/cm + Sidebar/DocPane/TopBar/
  SettingsPanel/Modal/NoteEditor/CodeEditor/App/main/styles
- 构建产物：首屏 index.js 17.5KB gz + css 2.1KB gz（达标 ≤200KB）；编辑器共享包
  134KB gz 懒加载（util-* chunk）；NoteEditor 91KB gz 懒加载
- 浏览器实测通过：三级目录创建/重命名、跨层级拖拽（数据层验证正确+非法拖拽拒绝）、
  笔记加粗（命令层+真实路径均验）、代码片段高亮（tok-* class 与编辑器一致）、
  CodeMirror 输入与 VS 配色、注释色即时切换、刷新持久化（IndexedDB）
- 修复的 bug：二级目录缺「＋新建笔记节点」按钮（depth<2 → depth<3）；
  工具栏按钮 onMouseDown preventDefault 防失焦；拖入折叠目录自动展开；
  tok-string2 高亮色补充
- 测试环境假象（非 bug）：IAB 面板无 OS 焦点时按键丢失；preact fast-refresh 重置
  模块级 signal 导致的假性状态丢失；真刷新后 expandAllDirs 正常

## 2026-09-26 P0
- 环境探测完成：Node 24/npm 11 OK；gh 无 → git credential fill token（scope: repo,workflow）可用
- 编译后端实测：Piston 401（白名单制已死）；**Wandbox gcc-13.2.0 OK**（stdin=21 → ok 42）；
  Coliru stdin 不进程序（输出错误值）弃用
- Supabase：复用词汇站项目（URL qvemohfojzawpnleyjsb.supabase.co，anon key sb_publishable_…），
  profiles/app_config/is_admin() 直接复用，新表加 ds_ 前缀
- 建仓 jlshdsdk/ds-code-notes 成功（API，ASCII 描述）
- 下一步：P2 编译运行（lib/compile.ts Wandbox 适配层 + 运行面板接线 + 8 用例验收）
