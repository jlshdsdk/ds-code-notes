import { cpp } from '@codemirror/lang-cpp';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { escapeHtml } from './util';

const cppParser = cpp().language.parser;

/** C++ 代码 → 带 .tok-* class 的高亮 HTML（与编辑器共用同一套配色 CSS） */
export function highlightCpp(code: string): string {
  if (!code.trim()) return escapeHtml(code);
  try {
    const tree = cppParser.parse(code);
    let html = '';
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text, classes) => {
        html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => {
        html += '\n';
      }
    );
    return html;
  } catch {
    return escapeHtml(code);
  }
}
