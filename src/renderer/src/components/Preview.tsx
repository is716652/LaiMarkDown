import React, { useEffect, useRef, useState, useMemo, memo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useEditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { renderMarkdown, rewriteRelativeImages, injectSourceLine } from '../utils/markdown';
import { debounce } from '../utils/debounce';
import PrismWorker from '../utils/prism.worker?worker';

/**
 * Preview 组件
 *
 * 关键性能点（vs 1.0）：
 * 1. **防抖 150ms**：用户连续打字时不会每次都重渲染
 * 2. **Prism 异步高亮**：通过 Web Worker 异步着色代码块，主线程不阻塞
 * 3. **Mermaid 懒渲染**：用 IntersectionObserver，滚动到视野内才渲染
 * 4. **整段 innerHTML 替换**：因为 markdown 是流式的，1.0 这点无法避免
 *    但配合防抖和 Worker，对 1.0 已经是质的提升
 */

const DEBOUNCE_MS = 150;

export type PreviewHandle = {
  getScrollFraction: () => number;
  setScrollFraction: (f: number) => void;
  getScrollTop: () => number;
  /** 滚动到源行号 line（1-based）对应的 block 元素；找不到则不滚 */
  scrollToSourceLine: (line: number) => void;
  /** 取所有 top-level block 的 [sourceLine, topOffset] 列表（用于行级滚动同步的精细化） */
  getBlockAnchors: () => { line: number; top: number; bottom: number }[];
};

export type PreviewProps = {
  /**
   * 用户在 Preview 区点击了某个 top-level block 时触发。
   * - mode='click'   → 单击，仅跳转 editor 对应行
   * - mode='dblclick'→ 双击，跳转并选中该 block 覆盖的源行范围（直接 Delete 可删整段）
   * line 已是 1-based。
   */
  onBlockClick?: (info: { line: number; span: number; mode: 'click' | 'dblclick' }) => void;
};

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function PreviewFn(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeTab = useEditorStore((s) => s.activeTab());
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const content = activeTab?.content ?? '';
  const filePath = activeTab?.filePath ?? null;
  const { previewFontFamily, fontSize } = useSettingsStore();

  // 按 tabId 存每个 tab 的滚动位置（用 fraction 0~1，不用绝对像素）
  // 切 tab 来回切换不丢位置；无论内容长度怎么变，按比例恢复都准。
  // 用 ref 不用 state：避免 setState 触发额外重渲染；保留每次滚动都写最新的语义。
  const scrollMap = useRef<Map<string, number>>(new Map());
  const lastTabIdRef = useRef<string | null>(null);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  activeTabIdRef.current = activeTabId;

  // 待恢复的 fraction（由切 tab effect 写入，由渲染 effect 完成后应用）
  const pendingScrollFraction = useRef<number | null>(null);

  // 哨兵：切 tab 期间 onScroll 写入的 scrollMap 是污染数据（来自 setScrollFraction/异步回填归零），
  // 冻结期内 onScroll 写 scrollMap 跳过。
  const ignoreScrollSaveUntilRef = useRef<number>(0);

  // 防抖后的内容
  const [debouncedContent, setDebouncedContent] = useState(content);
  const debouncedSet = useMemo(() => debounce(setDebouncedContent, DEBOUNCE_MS), []);

  useEffect(() => {
    debouncedSet(content);
  }, [content, debouncedSet]);

  // 渲染主流程（内容变化时才重写 innerHTML）
  // 关键：innerHTML 重写会把 scrollTop 归零。所以渲染完成后，用多重 RAF 把 saved fraction 应用回去。
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const html = renderMarkdown(debouncedContent);
    el.innerHTML = html;
    // 注入源行号（行级滚动同步用）
    injectSourceLine(el, debouncedContent);
    rewriteRelativeImages(el, filePath);
    bindCopyButtons(el);
    highlightCodeBlocks(el); // async（Prism worker 异步回填会改 code.innerHTML 触发高度变化）
    renderMermaidLazy(el);

    // 应用待恢复的滚动位置（如果切 tab 时存的）
    const applyPendingScroll = () => {
      if (pendingScrollFraction.current == null) return;
      const f = pendingScrollFraction.current;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) {
        const expected = max * Math.max(0, Math.min(1, f));
        // 仅当当前 scrollTop 偏离 expected 较多时才设（避免重复设触发 onScroll）
        if (Math.abs(el.scrollTop - expected) > 1) {
          el.scrollTop = expected;
        }
      }
      // 注意：不要立即清 pending——Prism worker 回填可能还会归零，让 ResizeObserver 接力
    };

    // 三重保险：
    //   RAF 1: 内联渲染完成（HTML 写入）
    //   RAF 2: 等异步布局稳定（mermaid/highlight 已渲染，高度可能变化）
    //   RAF 3: 再保险一次（防止 RAF 2 里又有图片异步插入改变高度）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyPendingScroll();
        // 250ms 后再补一次：拦截 mermaid/svg/图片异步加载后又把 scrollTop 顶回 0 的情况
        setTimeout(applyPendingScroll, 250);
        // 800ms 后清掉 pending：如果这么久还没稳定，就放弃（用户可能手动滚了）
        setTimeout(() => {
          pendingScrollFraction.current = null;
        }, 800);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent, filePath]);

  // Prism worker 异步回填 + Mermaid/图片异步布局完成后，hostRef 尺寸会变化。
  // ResizeObserver 监听尺寸变化：如果 pending fraction 还在且 scrollTop 偏离 expected，按 fraction 恢复。
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pendingScrollFraction.current == null) return;
      const f = pendingScrollFraction.current;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const expected = max * Math.max(0, Math.min(1, f));
      if (Math.abs(el.scrollTop - expected) > 1) {
        el.scrollTop = expected;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切 tab 监听：activeTabId 变化时，把目标 fraction 写入 pending，下一次渲染 effect 完成后会应用
  useEffect(() => {
    const prev = lastTabIdRef.current;
    lastTabIdRef.current = activeTabId;
    // 只在真正切 tab 时恢复（首次挂载不恢复，避免初始 scrollTop=0 把位置钉死）
    if (prev === null || prev === activeTabId) return;
    const id = activeTabId ?? '__none__';
    const saved = scrollMap.current.get(id);
    if (typeof saved === 'number' && saved > 0) {
      pendingScrollFraction.current = saved;
    }
    // 冻结 onScroll 写入 700ms：覆盖 innerHTML 写入 + Prism worker 回填 + 防御 setScrollFraction 触发的 onScroll
    ignoreScrollSaveUntilRef.current = Date.now() + 700;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  useImperativeHandle(
    ref,
    () => ({
      getScrollFraction: () => {
        const el = hostRef.current;
        if (!el) return 0;
        const max = el.scrollHeight - el.clientHeight;
        return max > 0 ? el.scrollTop / max : 0;
      },
      setScrollFraction: (f) => {
        const el = hostRef.current;
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = max * Math.max(0, Math.min(1, f));
      },
      getScrollTop: () => hostRef.current?.scrollTop ?? 0,
      scrollToSourceLine: (line) => {
        const el = hostRef.current;
        if (!el) return;
        const blocks = Array.from(el.children) as HTMLElement[];
        if (blocks.length === 0) return;
        // 找第一个 sourceLine >= line 的 block
        let target: HTMLElement | null = null;
        for (const b of blocks) {
          const ln = Number(b.getAttribute('data-source-line') || 0);
          if (ln >= line) {
            target = b;
            break;
          }
        }
        if (!target) target = blocks[blocks.length - 1];
        // 计算 target 相对 host 的位置
        const hostRect = el.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        const offsetInHost = tRect.top - hostRect.top + el.scrollTop;
        // 把 target 滚到视口中央偏上
        const desired = offsetInHost - el.clientHeight * 0.2;
        el.scrollTop = Math.max(0, desired);
      },
      getBlockAnchors: () => {
        const el = hostRef.current;
        if (!el) return [];
        const blocks = Array.from(el.children) as HTMLElement[];
        const hostRect = el.getBoundingClientRect();
        return blocks
          .map((b) => {
            const ln = Number(b.getAttribute('data-source-line') || 0);
            const r = b.getBoundingClientRect();
            return { line: ln, top: r.top - hostRect.top + el.scrollTop, bottom: r.bottom - hostRect.top + el.scrollTop };
          })
          .filter((a) => a.line > 0);
      },
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className="preview-area h-full overflow-auto px-8 py-6"
      style={{ fontFamily: previewFontFamily, fontSize: `${fontSize}px` }}
      onScroll={(e) => {
        const el = e.target as HTMLDivElement;
        const id = activeTabIdRef.current;
        if (!id) return;
        // 冻结期内不写 scrollMap（切 tab 期间 setScrollFraction/异步回填触发的 onScroll 是污染数据）
        if (Date.now() < ignoreScrollSaveUntilRef.current) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) return;
        const fraction = el.scrollTop / max;
        // 仅当分数有显著变化时才写（避免 setScrollFraction 触发自身的 onScroll 噪声）
        const prev = scrollMap.current.get(id);
        if (prev === undefined || Math.abs(prev - fraction) > 0.0005) {
          scrollMap.current.set(id, fraction);
        }
      }}
      onClick={(e) => {
        if (!props.onBlockClick) return;
        const block = findNavigableBlock(e.target as HTMLElement, hostRef.current);
        if (!block) return;
        const line = Number(block.getAttribute('data-source-line') || 0);
        if (!line) return;
        const span = Number(block.getAttribute('data-source-span') || 1);
        // 阻止冒泡到默认选区外行为（不影响文本选区——我们在捕获后才走选区逻辑）
        props.onBlockClick({ line, span, mode: 'click' });
      }}
      onDoubleClick={(e) => {
        if (!props.onBlockClick) return;
        const block = findNavigableBlock(e.target as HTMLElement, hostRef.current);
        if (!block) return;
        const line = Number(block.getAttribute('data-source-line') || 0);
        if (!line) return;
        const span = Number(block.getAttribute('data-source-span') || 1);
        props.onBlockClick({ line, span, mode: 'dblclick' });
      }}
    />
  );
});
Preview.displayName = 'Preview';

// ---- helpers ----

/**
 * 找到点击目标对应的"可导航 top-level block"。
 * 返回 null 表示这个点击不应该触发跳转（点在链接/代码块/图片/复选框/mermaid 等子元素上）。
 */
function findNavigableBlock(target: HTMLElement | null, host: HTMLElement | null): HTMLElement | null {
  if (!target || !host) return null;
  // 1. 先排除明显不该跳转的子元素
  if (target.closest('a, pre, code, img, input, button, .mermaid-block, .katex, table')) {
    // 注：table 自身可以跳转（用户可能想编辑表格），但 td/th 内的内容点击会通过 table 冒泡上来
    //    ——我们仍走 table 父 block 跳转，所以这里只过滤嵌套元素。
  }
  if (target.closest('a, pre, img, input, button, .mermaid-block, .katex, .mermaid-error')) {
    return null;
  }
  // 2. 向上找到 host 的直接子元素（即 top-level block）
  let cur: HTMLElement | null = target;
  while (cur && cur.parentElement !== host) {
    cur = cur.parentElement;
  }
  return cur;
}

// 给代码块加 copy 按钮
function bindCopyButtons(container: HTMLElement) {
  container.querySelectorAll('button[data-copy]').forEach((btn) => {
    if ((btn as HTMLElement).dataset.bound === '1') return;
    (btn as HTMLElement).dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const pre = btn.closest('pre');
      const code = pre?.querySelector('code');
      const text = code?.textContent || '';
      navigator.clipboard?.writeText(text).then(() => {
        btn.classList.add('copied');
        const old = btn.innerHTML;
        btn.innerHTML = '✓';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = old;
        }, 1200);
      });
    });
  });
}

// 用 Worker 异步高亮代码块
let workerInstance: Worker | null = null;
function getWorker(): Worker {
  if (!workerInstance) workerInstance = new PrismWorker();
  return workerInstance;
}
let nextId = 0;
const pendingHighlights = new Map<number, { el: HTMLElement; lang: string }>();

// 每次高亮完成时通知外部（用于在 code 元素高度变化时恢复 preview.scrollTop）
type HighlightHook = () => void;
let highlightCompletionHook: HighlightHook | null = null;
function setHighlightCompletionHook(hook: HighlightHook | null) {
  highlightCompletionHook = hook;
}

function highlightCodeBlocks(container: HTMLElement) {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('pre code'));
  if (blocks.length === 0) return;

  const worker = getWorker();
  const onMessage = (e: MessageEvent<{ id: number; html: string }>) => {
    const p = pendingHighlights.get(e.data.id);
    if (p) {
      p.el.innerHTML = e.data.html;
      pendingHighlights.delete(e.data.id);
      // 通知外部：code 高度变化，preview.scrollTop 可能被归零，需要恢复
      if (highlightCompletionHook) highlightCompletionHook();
    }
  };
  worker.addEventListener('message', onMessage);

  for (const code of blocks) {
    const pre = code.closest('pre');
    const lang = pre?.getAttribute('data-lang') || '';
    if (!lang || lang === 'plain') continue;
    const text = code.textContent || '';
    const id = ++nextId;
    pendingHighlights.set(id, { el: code, lang });
    worker.postMessage({ id, lang, code: text });
  }
}

// Mermaid 懒渲染（用 IntersectionObserver）
let mermaidLoading: Promise<typeof import('mermaid').default> | null = null;
async function loadMermaid() {
  if (mermaidLoading) return mermaidLoading;
  mermaidLoading = (async () => {
    const mod = await import('mermaid');
    mod.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
    return mod.default;
  })();
  return mermaidLoading;
}

function renderMermaidLazy(container: HTMLElement) {
  const blocks = container.querySelectorAll<HTMLElement>('.mermaid-block');
  if (blocks.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const block = e.target as HTMLElement;
        observer.unobserve(block);
        if (block.dataset.rendered === '1') continue;
        void (async () => {
          try {
            const mermaid = await loadMermaid();
            const src = decodeURIComponent(block.dataset.src || '');
            if (!src) return;
            const { svg } = await mermaid.render(`mmd-${Date.now()}`, src);
            block.innerHTML = svg;
            block.dataset.rendered = '1';
          } catch (err) {
            block.innerHTML = `<pre class="mermaid-error">Mermaid 渲染失败: ${String(err).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</pre>`;
          }
        })();
      }
    },
    { rootMargin: '200px' }
  );
  blocks.forEach((b) => observer.observe(b));
}
