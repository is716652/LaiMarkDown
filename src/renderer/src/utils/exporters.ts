/**
 * 导出工具
 * - exportHTML: 渲染好的 HTML 套独立 CSS 模板，浏览器直接下载
 * - exportPDF:  通过 IPC 调主进程 webContents.printToPDF —— 中文表格 100% 正常，无对话框
 */
import { renderMarkdown } from './markdown';

/* ============================================================
 *  HTML 导出（独立可分发）
 * ============================================================ */
const HTML_TEMPLATE = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #fafafa; --text: #18181b; --subtle: #71717a; --border: #e4e4e7;
          --accent: #f59e0b; --accent-soft: rgba(245,158,11,0.15); --muted: #f4f4f5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1b26; --text: #c0caf5; --subtle: #565f89; --border: #2a2f45;
            --accent: #e0af68; --accent-soft: rgba(224,175,104,0.2); --muted: #2a2f45; }
  }
  html, body { background: var(--bg); color: var(--text); margin: 0; padding: 0; }
  body { font-family: "Source Han Sans SC", "Microsoft YaHei", -apple-system, sans-serif;
         line-height: 1.7; padding: 32px 64px; max-width: 900px; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; font-weight: 700; line-height: 1.3; }
  h1 { font-size: 1.9em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
  h3 { font-size: 1.25em; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote { margin: 1em 0; padding: 0.4em 1em; border-left: 4px solid var(--accent);
               background: var(--muted); color: var(--subtle); border-radius: 0 4px 4px 0; }
  code:not(pre code) { background: var(--muted); padding: 2px 6px; border-radius: 3px;
                       font-size: 0.9em; font-family: "JetBrains Mono", Consolas, monospace; }
  pre { background: var(--muted); border: 1px solid var(--border); border-radius: 6px;
        padding: 12px 16px; overflow-x: auto; font-size: 0.9em; line-height: 1.5; }
  pre code { font-family: "JetBrains Mono", Consolas, monospace; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 6px 12px; }
  th { background: var(--muted); font-weight: 700; }
  tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
  @media (prefers-color-scheme: dark) { tr:nth-child(even) td { background: rgba(255,255,255,0.03); } }
  img { max-width: 100%; border-radius: 4px; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
  .heading-anchor { color: var(--subtle); text-decoration: none; margin-right: 0.4em; }
  .task-item { list-style: none; }
  .task-item input[type="checkbox"] { margin-right: 6px; }
  .math-block { margin: 1em 0; text-align: center; }
  .math-inline { display: inline-block; }
  .mermaid-block { background: var(--muted); border: 1px solid var(--border);
                   border-radius: 6px; padding: 16px; text-align: center; margin: 1em 0; }
  .mermaid-block svg { max-width: 100%; height: auto; }
  .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6b7280; font-style: italic; }
  .token.boolean, .token.number { color: #f59e0b; }
  .token.string, .token.char, .token.attr-value { color: #10b981; }
  .token.keyword, .token.tag, .token.selector { color: #8b5cf6; }
  .token.function, .token.class-name { color: #3b82f6; }
  .token.operator, .token.punctuation { color: var(--text); }
</style>
</head>
<body>
${body}
</body>
</html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * 把文件名清洗成可作为导出文件名的形式：
 * - 去掉 .md / .markdown 后缀
 * - 把 Windows 非法字符替换成 _
 * - 去掉首尾空白
 * - 空字符串兜底为 'untitled'
 */
function sanitizeExportBaseName(title: string): string {
  const noExt = (title || 'untitled').replace(/\.(md|markdown|markdown\.txt)$/i, '');
  return noExt.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}

export async function exportHTML(opts: {
  title: string;
  markdown: string;
}): Promise<{ ok: boolean; defaultName: string; html: string }> {
  const body = renderMarkdown(opts.markdown);
  const html = HTML_TEMPLATE(opts.title || 'Untitled', body);
  const safeTitle = sanitizeExportBaseName(opts.title);
  return { ok: true, defaultName: `${safeTitle}.html`, html };
}

/* ============================================================
 *  PDF 导出（主进程 webContents.printToPDF）
 *  - 浏览器原生排版引擎，中文表格 100% 正常
 *  - 不弹任何对话框，IPC 一步到位
 * ============================================================ */
export async function exportPDF(opts: {
  title: string;
  markdown: string;
  defaultName?: string;
}): Promise<{ ok: true; defaultName: string } | { ok: false; canceled?: boolean; error?: string }> {
  try {
    const body = renderMarkdown(opts.markdown);
    // 给 HTML 模板额外加 @media print 的打印样式
    const fullHtml = HTML_TEMPLATE(opts.title || 'Untitled', body).replace(
      '</style>',
      `
  @media print {
    html, body { background: #ffffff !important; color: #000000 !important; }
    body { padding: 0 !important; max-width: none !important; }
    a { color: #000 !important; text-decoration: none !important; }
    pre, code { background: #f4f4f4 !important; color: #000 !important;
                border-color: #ddd !important; white-space: pre-wrap !important;
                word-break: break-word !important; }
    table { page-break-inside: avoid; width: 100% !important; table-layout: auto !important; }
    tr, td, th { page-break-inside: avoid; word-break: break-word; }
    h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
    img, svg { max-width: 100% !important; page-break-inside: avoid; }
    blockquote { background: #f9f9f9 !important; color: #555 !important; }
    /* 关键：取消每个 cell 的最小宽度，强制内容自适应 */
    th, td { min-width: 0 !important; width: auto !important; }
  }
  @page { size: A4; margin: 14mm 12mm; }
</style>`,
    );

    const safeTitle = sanitizeExportBaseName(opts.title);
    const defaultName = opts.defaultName || `${safeTitle}.pdf`;

    const r = await window.api.exportPDF({ html: fullHtml, defaultName });
    if (r.ok) return { ok: true, defaultName };
    if ('canceled' in r && r.canceled) return { ok: false, canceled: true };
    return { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}

/* ============================================================
 *  保存对话框 + 落盘
 * ============================================================ */
export async function saveBlobAs(blob: Blob, defaultName: string, ext: string): Promise<boolean> {
  const r = await window.api.saveFileDialog({ defaultPath: defaultName, extension: ext });
  if (r.canceled || !r.filePath) return false;
  const arr = new Uint8Array(await blob.arrayBuffer());
  const w = await window.api.writeBinaryFile(r.filePath, arr);
  if (!w.ok) {
    alert('保存失败：' + w.error);
    return false;
  }
  return true;
}

export async function saveTextAs(content: string, defaultName: string, ext: string): Promise<boolean> {
  const r = await window.api.saveFileDialog({ defaultPath: defaultName, extension: ext });
  if (r.canceled || !r.filePath) return false;
  const w = await window.api.writeFile(r.filePath, content);
  if (!w.ok) {
    alert('保存失败：' + w.error);
    return false;
  }
  return true;
}
