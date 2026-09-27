import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Editor,
  Node,
  mergeAttributes,
} from '@tiptap/core';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { getDB, putNote } from '../lib/db';
import { highlightCpp } from '../lib/highlight';
import { resolveImageUrl, storeImageFile } from '../lib/images';
import { debounce } from '../lib/util';
import { nodes, showToast } from '../state';

// ---------------- 扩展：textStyle 带字号/字体 ----------------

const DsTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.fontSize || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.fontSize ? { style: `font-size:${String(attrs.fontSize)}` } : {},
      },
      fontFamily: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.fontFamily || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.fontFamily ? { style: `font-family:${String(attrs.fontFamily)}` } : {},
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setFontSize:
        (size: string) =>
        ({ commands }) =>
          commands.updateAttributes('textStyle', { fontSize: size }),
      unsetFontSize:
        () =>
        ({ commands }) =>
          commands.resetAttributes('textStyle', 'fontSize'),
      setFontFamily:
        (family: string) =>
        ({ commands }) =>
          commands.updateAttributes('textStyle', { fontFamily: family }),
      unsetFontFamily:
        () =>
        ({ commands }) =>
          commands.resetAttributes('textStyle', 'fontFamily'),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dsTextStyle: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

// ---------------- 扩展：笔记图片（blob 引用，不外链） ----------------

const DsImage = Node.create({
  name: 'dsImage',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      imgId: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-img-id'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.imgId ? { 'data-img-id': String(attrs.imgId) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-img-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'ds-note-img' })];
  },
  addNodeView() {
    return ({ node }) => {
      const wrap = document.createElement('div');
      wrap.className = 'ds-img-wrap';
      const img = document.createElement('img');
      img.className = 'ds-note-img';
      const id = node.attrs.imgId as string;
      void resolveImageUrl(id).then(u => {
        if (u) img.src = u;
        else img.alt = '（图片缺失，等待云同步）';
      });
      wrap.appendChild(img);
      return { dom: wrap };
    };
  },
});

// ---------------- 扩展：C++ 高亮代码片段（只展示不可运行） ----------------

export interface SnippetDraft {
  code: string;
  save: (code: string) => void;
}
const snippetDraft = signal<SnippetDraft | null>(null);

const CppSnippet = Node.create({
  name: 'cppSnippet',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (el: HTMLElement) => el.textContent ?? '',
      },
    };
  },
  parseHTML() {
    return [{ tag: 'pre[data-cpp-snippet]' }];
  },
  renderHTML({ node }) {
    return ['pre', { 'data-cpp-snippet': '1' }, ['code', node.attrs.code as string]];
  },
  addNodeView() {
    return ({ node, editor: ed, getPos }) => {
      const wrap = document.createElement('div');
      wrap.className = 'ds-snippet-wrap';
      const pre = document.createElement('pre');
      pre.className = 'ds-snippet';
      const codeEl = document.createElement('code');
      codeEl.innerHTML = highlightCpp((node.attrs.code as string) ?? '');
      pre.appendChild(codeEl);
      const btn = document.createElement('button');
      btn.className = 'ghost-btn ds-snippet-edit';
      btn.textContent = '编辑';
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        snippetDraft.value = {
          code: (node.attrs.code as string) ?? '',
          save: newCode => {
            if (ed.isDestroyed) {
              snippetDraft.value = null;
              return;
            }
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (typeof pos === 'number') {
              ed.view.dispatch(ed.view.state.tr.setNodeMarkup(pos, undefined, { code: newCode }));
            }
            snippetDraft.value = null;
          },
        };
      });
      wrap.appendChild(btn);
      wrap.appendChild(pre);
      return { dom: wrap };
    };
  },
});

/** 工具栏按钮按下时不抢走编辑器焦点（TipTap 工具栏标准做法） */
const keepFocus = (e: MouseEvent) => e.preventDefault();

function SnippetModal() {  const draft = snippetDraft.value!;
  const [code, setCode] = useState(draft.code);
  return (
    <div class="modal-mask" onClick={() => (snippetDraft.value = null)}>
      <div class="modal" onClick={e => e.stopPropagation()}>
        <div class="modal-title">编辑代码片段</div>
        <textarea
          class="snippet-ta"
          value={code}
          spellcheck={false}
          onInput={e => setCode((e.target as HTMLTextAreaElement).value)}
        />
        <div class="modal-actions">
          <button class="ghost-btn" onClick={() => (snippetDraft.value = null)}>
            取消
          </button>
          <button class="primary" onClick={() => draft.save(code)}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 主体 ----------------

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28];
/** 笔记字体颜色预设（用户指定：黑/紫/红三选一） */
const COLOR_SWATCHES: Array<[string, string]> = [
  ['#000000', '黑色'],
  ['#7c3aed', '紫色'],
  ['#dc2626', '红色'],
];
const FONTS: Array<[string, string]> = [
  ['', '默认字体'],
  ['system-ui, "Microsoft YaHei", sans-serif', '系统默认'],
  ['"Microsoft YaHei", sans-serif', '微软雅黑'],
  ['SimSun, serif', '宋体'],
  ['SimHei, sans-serif', '黑体'],
  ['KaiTi, serif', '楷体'],
  ['Consolas, "Courier New", monospace', 'Consolas 等宽'],
  ['"Times New Roman", serif', 'Times New Roman'],
  ['Arial, sans-serif', 'Arial'],
];

export default function NoteEditor({ docId }: { docId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dirtyRef = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let save: ReturnType<typeof debounce<[string]>> | null = null;
    // 卸载/隐藏时立即落盘；节点已删除则不写（防删除后把行"复活"成孤儿）
    const flushNow = () => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed || !dirtyRef.current) return;
      if (!nodes.value.has(docId)) return;
      dirtyRef.current = false;
      void putNote({ docId, html: ed.getHTML(), updatedAt: Date.now() }).catch(() =>
        showToast('笔记保存失败')
      );
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        save?.cancel();
        flushNow();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    (async () => {
      const row = await (await getDB()).get('notes', docId);
      if (cancelled || !hostRef.current) return;
      save = debounce((html: string) => {
        if (!nodes.value.has(docId)) return;
        void putNote({ docId, html, updatedAt: Date.now() }).catch(() =>
          showToast('笔记保存失败')
        );
      }, 800);
      const saveDebounced = save;
      const ed = new Editor({
        element: hostRef.current,
        extensions: [StarterKit, DsTextStyle, Color, DsImage, CppSnippet],
        content: row?.html ?? '<p></p>',
        editorProps: {
          handlePaste: (_view, event) => {
            const files = event.clipboardData?.files;
            if (!files || files.length === 0) return false;
            const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (imgs.length !== files.length) return false;
            event.preventDefault();
            void insertImages(imgs);
            return true;
          },
        },
        onUpdate: ({ editor: cur }) => {
          dirtyRef.current = true;
          saveDebounced(cur.getHTML());
        },
      });
      editorRef.current = ed;
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__dsEditor = ed;
      }
      ed.on('transaction', () => force(v => v + 1));
      setEditor(ed);
    })();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      snippetDraft.value = null;
      save?.cancel();
      const ed = editorRef.current;
      if (ed) {
        flushNow();
        ed.destroy();
        editorRef.current = null;
        setEditor(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function insertImages(files: File[]): Promise<void> {
    for (const f of files) {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      try {
        const imgId = await storeImageFile(f, docId);
        ed.chain().focus().insertContent({ type: 'dsImage', attrs: { imgId } }).run();
      } catch {
        showToast('图片保存失败');
      }
    }
  }

  const attrs = editor ? editor.getAttributes('textStyle') : {};
  const curSize = (attrs.fontSize as string | undefined) ?? '';
  const curFont = (attrs.fontFamily as string | undefined) ?? '';
  const chain = () => editor!.chain().focus();

  return (
    <div class="note-editor">
      <div class="nt-toolbar">
        <button
          class={editor?.isActive('bold') ? 'ghost-btn nt-bold' : 'ghost-btn'}
          disabled={!editor}
          title="加粗"
          onMouseDown={keepFocus}
          onClick={() => chain().toggleBold().run()}
        >
          B
        </button>
        <span class="sep" />
        <select
          title="字体大小"
          disabled={!editor}
          value={curSize}
          onChange={e => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) chain().setFontSize(`${v}px`).run();
            else chain().unsetFontSize().run();
          }}
        >
          <option value="">字号</option>
          {FONT_SIZES.map(s => (
            <option key={s} value={String(s)}>
              {s}px
            </option>
          ))}
        </select>
        <select
          title="字体"
          disabled={!editor}
          value={curFont}
          onChange={e => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) chain().setFontFamily(v).run();
            else chain().unsetFontFamily().run();
          }}
        >
          {FONTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {COLOR_SWATCHES.map(([value, label]) => (
          <button
            key={value}
            class={
              (attrs.color as string | undefined)?.toLowerCase() === value
                ? 'color-swatch on'
                : 'color-swatch'
            }
            style={{ background: value }}
            title={`字体颜色：${label}`}
            disabled={!editor}
            onMouseDown={keepFocus}
            onClick={() => chain().setColor(value).run()}
          />
        ))}
        <button
          class="ghost-btn"
          disabled={!editor}
          title="清除格式颜色"
          onMouseDown={keepFocus}
          onClick={() => chain().unsetColor().unsetFontSize().unsetFontFamily().run()}
        >
          默认
        </button>
        <span class="sep" />
        <button
          class="ghost-btn"
          disabled={!editor}
          onMouseDown={keepFocus}
          onClick={() => fileRef.current?.click()}
        >
          插入图片
        </button>
        <button
          class="ghost-btn"
          disabled={!editor}
          onMouseDown={keepFocus}
          onClick={() =>
            chain()
              .insertContent({ type: 'cppSnippet', attrs: { code: '// 在这里写 C++ 代码' } })
              .run()
          }
        >
          插入代码片段
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            const input = e.target as HTMLInputElement;
            if (input.files && input.files.length) {
              void insertImages(Array.from(input.files));
              input.value = '';
            }
          }}
        />
      </div>
      <div class="nt-host" ref={hostRef} />
      {snippetDraft.value && <SnippetModal />}
    </div>
  );
}
