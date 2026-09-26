import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { debounce } from './util';

/** Visual Studio 浅色系观感：背景/注释色走 CSS 变量，设置面板改变量即时全站生效 */
const dsTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--ds-editor-bg)',
    color: '#1f1f1f',
  },
  '.cm-scroller': {
    fontFamily: 'Consolas, "Courier New", monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { caretColor: '#111111' },
  '.cm-gutters': {
    backgroundColor: 'var(--ds-editor-bg)',
    color: '#9a9a9a',
    border: 'none',
    borderRight: '1px solid #ececec',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(0, 0, 0, 0.045)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(0, 0, 0, 0.06)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#add6ff',
  },
  '.cm-searchMatch': { backgroundColor: '#ffe066' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ffb26b' },
});

export function makeEditorView(
  parent: HTMLElement,
  doc: string,
  onChange: (code: string) => void
): EditorView {
  const save = debounce(onChange, 800);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        indentUnit.of('    '),
        EditorState.allowMultipleSelections.of(true),
        cpp(),
        syntaxHighlighting(classHighlighter),
        dsTheme,
        highlightActiveLine(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of(u => {
          if (u.docChanged) save(u.state.doc.toString());
        }),
      ],
    }),
  });
}
