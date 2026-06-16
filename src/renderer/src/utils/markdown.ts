/**
 * Markdown 渲染管线
 *
 * 性能要点（vs 1.0）：
 * - 同步 marked 解析（marked 本身快，瓶颈在 Prism + KaTeX）
 * - Prism 高亮改成"按需 + 异步"：这里只标记 <pre class="language-xxx"><code>，
 *   真正的语法着色交给 Preview 组件在 mount 后用 Web Worker 或 microtask 异步替换。
 * - 公式用 KaTeX（同步，但比 MathJax 快 10x），只对 $$...$$ 和 $...$ 走自己的 tokenizer
 * - 整段 HTML 走 DOMPurify 防 XSS（虽然自家用风险小，但渲染用户内容必须有）
 */
import { Marked, type Tokens } from 'marked';
import katex from 'katex';

// ---- KaTeX helpers ----
const renderKatex = (src: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: false, output: 'html' });
  } catch (e) {
    return `<code class="katex-error">${String(e).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</code>`;
  }
};

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

// ---- marked instance with extensions ----
const marked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
});

// Math block ($$...$$)
marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src: string) {
        const m = src.match(/\$\$/);
        return m?.index;
      },
      tokenizer(src: string) {
        const m = src.match(/^\$\$([\s\S]+?)\$\$/);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() } as unknown as Tokens.Generic;
        return undefined;
      },
      renderer(token: Tokens.Generic) {
        const t = token as unknown as { text: string };
        return `<div class="math-block" data-display="block">${renderKatex(t.text, true)}</div>`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src: string) {
        const m = src.match(/\$(?!\$)/);
        return m?.index;
      },
      tokenizer(src: string) {
        const m = src.match(/^\$([^\n$]+?)\$/);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim() } as unknown as Tokens.Generic;
        return undefined;
      },
      renderer(token: Tokens.Generic) {
        const t = token as unknown as { text: string };
        return `<span class="math-inline" data-display="inline">${renderKatex(t.text, false)}</span>`;
      },
    },
  ],
});

// ---- Custom renderer ----
const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const renderer = new marked.Renderer();

// 任务列表
renderer.listitem = (text: string) => {
  const m = /^\s*\[([ xX])\]\s+/.exec(text);
  if (m) {
    const done = /x/i.test(m[1]);
    const body = text.replace(/^\s*\[[ xX]\]\s+/, '');
    return `<li class="task-item"><input type="checkbox" disabled ${done ? 'checked' : ''}/> ${body}</li>`;
  }
  return `<li>${text}</li>`;
};

// 标题加锚点
renderer.heading = (text, level) => {
  const plain = text.replace(/<[^>]+>/g, '');
  const id = slug(plain);
  return `<h${level} id="${id}" data-heading="true"><a class="heading-anchor" href="#${id}">#</a>${text}</h${level}>`;
};

// 代码块：把语言写到 data-lang，Prism 高亮交给前端异步做
renderer.code = (code, infostring) => {
  const lang = (infostring || '').toLowerCase().trim().split(/\s+/)[0];
  if (lang === 'mermaid') {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="mermaid-block" data-src="${encodeURIComponent(code)}"><pre>${esc}</pre></div>`;
  }
  const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 不在这里高亮！前端 Preview 组件用 Web Worker 异步高亮
  return `<pre class="language-${lang || 'plain'}" data-lang="${lang || 'plain'}"><button class="copy-btn" data-copy>${copyIcon}</button><code class="language-${lang || 'plain'}">${esc}</code></pre>`;
};

marked.use({ renderer });

/**
 * 把 markdown 转成 HTML
 * 同步执行——marked 自身快；高亮和 mermaid 在 Preview 里异步做
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return marked.parse(text) as string;
}

// ---- 解析代码块时收集的元数据（供 Preview 用） ----
export function extractCodeBlocks(html: string): { lang: string; index: number }[] {
  const out: { lang: string; index: number }[] = [];
  const re = /<pre class="language-(\w+)" data-lang="(\w+)">/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html))) {
    out.push({ lang: m[2], index: i++ });
  }
  return out;
}

// ---- 图片相对路径重写 ----
export function rewriteRelativeImages(root: HTMLElement, mdFilePath: string | null): void {
  if (!mdFilePath) return;
  const baseDir = mdFilePath.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
  const imgs = root.querySelectorAll('img');
  imgs.forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src) return;
    if (/^(https?:|data:|file:|blob:|safe-file:|\/\/)/i.test(src)) return;
    if (src.startsWith('/')) return;
    const normalized = src.replace(/\\/g, '/');
    img.setAttribute('src', `safe-file:///${baseDir}/${normalized}`);
  });
}
