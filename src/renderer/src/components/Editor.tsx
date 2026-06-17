import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, search, highlightSelectionMatches } from '@codemirror/search';
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { useEditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';

export type EditorHandle = {
  openFind: () => void;
  focus: () => void;
  getScrollFraction: () => number;
  setScrollFraction: (f: number) => void;
  goToLine: (line: number) => void;
  /** 当前光标所在源行号（1-based） */
  getCursorLine: () => number;
  /** 取编辑器视口顶部那行的行号（用于精确滚动同步） */
  getTopVisibleLine: () => number;
  /** 流式打开：在 doc 末尾追加一块文本（不触发 store 更新） */
  appendChunk: (chunk: string) => void;
  /** 清空整个 doc（流式打开前调用） */
  clearDoc: () => void;
  /** 当前 doc 内容（用于流式打开完成后同步回 store） */
  getDoc: () => string;
  // ---- MD 格式化能力（供 FormatToolbar 调用）----
  /** 包裹选中文本。无选区时插入 before+placeholder+after 并选中 placeholder。
   *  - bold('**') / italic('*') / strike('~~') / code('`')
   *  - link('[', '](url)', 'text')  */
  wrapSelection: (before: string, after?: string, placeholder?: string) => void;
  /** 给当前行（或选区覆盖的每一行）加行首前缀。多行选区会自动每行都加。
   *  - heading('# ') / quote('> ') / bullet('- ') / num('1. ') / task('- [ ] ') / hr('') */
  linePrefix: (prefix: string) => void;
  /** 在光标处插入一段多行模板（替换当前选区），光标定位到 cursorOffset 处。
   *  可选 selectEndOffset 用来选中一段（如占位文本）。
   *  - codeBlock / table / image */
  insertBlock: (template: string, cursorOffset: number, selectEndOffset?: number) => void;
};

export const Editor = forwardRef<EditorHandle>(function EditorFn(_props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeComp = useRef(new Compartment());
  const lineNumComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const tabSizeComp = useRef(new Compartment());

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const updateContent = useEditorStore((s) => s.updateContent);
  const settings = useSettingsStore();
  const fontSize = settings.fontSize;
  const editorFontFamily = settings.editorFontFamily;
  const showLineNumbers = settings.lineNumbers;

  // 按 tabId 存每个 tab 的滚动位置（声明必须在 useEditorStore 之后，否则 TDZ）
  const scrollMap = useRef<Map<string, number>>(new Map());
  const lastTabIdRef = useRef<string | null>(activeTabId);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  // 同步 ref（让闭包永远拿到最新值）
  activeTabIdRef.current = activeTabId;
  const wordWrap = settings.wordWrap;
  const tabSize = settings.tabSize;

  useEffect(() => {
    if (!hostRef.current) return;

    const baseTheme = EditorView.theme({
      '&': { height: '100%', fontSize: `${fontSize}px`, fontFamily: editorFontFamily },
      '.cm-content': { caretColor: 'var(--accent)', padding: '16px 0' },
      '.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--subtle)', border: 'none' },
      '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'var(--muted)' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(122,162,247,0.25)' },
    });

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          // 滚动监听：按 tabId 存 scrollTop，切回时恢复
          EditorView.domEventHandlers({
            scroll(_event, v) {
              const id = activeTabIdRef.current;
              if (id) {
                scrollMap.current.set(id, v.scrollDOM.scrollTop);
              }
            },
          }),

          history(),
          bracketMatching(),
          indentOnInput(),
          foldGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          drawSelection(),
          rectangularSelection(),
          crosshairCursor(),
          dropCursor(),
          search({ top: true }),
          EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          keymap.of([
            {
              key: 'Mod-/',
              run: () => {
                window.dispatchEvent(new CustomEvent('app:toggle-preview'));
                return true;
              },
            },
            // MD 格式化快捷键（Ctrl 在 Windows/Linux, Cmd 在 Mac）
            {
              key: 'Mod-b',
              run: (v) => {
                const sel = v.state.selection.main;
                const txt = v.state.sliceDoc(sel.from, sel.to);
                const ph = txt || '粗体文字';
                v.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: '**' + ph + '**' },
                  selection: { anchor: sel.from + 2, head: sel.from + 2 + ph.length },
                  userEvent: 'input.format',
                });
                return true;
              },
            },
            {
              key: 'Mod-i',
              run: (v) => {
                const sel = v.state.selection.main;
                const txt = v.state.sliceDoc(sel.from, sel.to);
                const ph = txt || '斜体文字';
                v.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: '*' + ph + '*' },
                  selection: { anchor: sel.from + 1, head: sel.from + 1 + ph.length },
                  userEvent: 'input.format',
                });
                return true;
              },
            },
            {
              key: 'Mod-k',
              run: (v) => {
                const sel = v.state.selection.main;
                const txt = v.state.sliceDoc(sel.from, sel.to);
                const ph = txt || '链接文字';
                v.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: '[' + ph + '](https://)' },
                  selection: { anchor: sel.from + 1, head: sel.from + 1 + ph.length },
                  userEvent: 'input.format',
                });
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          themeComp.current.of(baseTheme),
          lineNumComp.current.of(showLineNumbers ? lineNumbers() : []),
          wrapComp.current.of(wordWrap ? EditorView.lineWrapping : []),
          tabSizeComp.current.of(EditorState.tabSize.of(tabSize)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const state = useEditorStore.getState();
              if (state.activeTabId) {
                updateContent(state.activeTabId, u.state.doc.toString());
              }
            }
          }),
          EditorView.domEventHandlers({
            paste: (e, v) => {
              const cd = e.clipboardData;
              if (!cd) return false;
              const items = Array.from(cd.items || []);
              const imgItem = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
              if (imgItem) {
                const file = imgItem.getAsFile();
                if (file) {
                  e.preventDefault();
                  void (async () => {
                    try {
                      const buf = await file.arrayBuffer();
                      const mime = file.type || 'image/png';
                      const ext =
                        mime.split('/')[1]?.replace('+xml', '').replace('jpeg', 'jpg') || 'png';
                      const mdPath = useEditorStore.getState().activeTab()?.filePath ?? null;
                      const r = await window.api.savePastedImage(mdPath, buf, ext);
                      if (r.ok) {
                        v.dispatch(v.state.replaceSelection(`![](${r.relativePath})`));
                      } else {
                        alert('保存粘贴图片失败：' + r.error);
                      }
                    } catch (err) {
                      console.error('paste image error', err);
                    }
                  })();
                  return true;
                }
              }
              return false;
            },
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    const doc = tab?.content ?? '';
    const isTabSwitch = lastTabIdRef.current !== activeTabId;
    lastTabIdRef.current = activeTabId ?? null;

    if (view.state.doc.toString() !== doc) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    }

    // 切 tab 时恢复滚动位置（用 ref 拿最新 activeTabId）
    if (isTabSwitch) {
      const id = activeTabIdRef.current ?? '__none__';
      const saved = scrollMap.current.get(id) ?? 0;
      if (saved > 0) {
        requestAnimationFrame(() => {
          if (viewRef.current) {
            viewRef.current.scrollDOM.scrollTop = saved;
          }
        });
      }
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeComp.current.reconfigure(
        EditorView.theme({
          '&': { fontSize: `${fontSize}px`, fontFamily: editorFontFamily },
        }),
      ),
    });
  }, [fontSize, editorFontFamily]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumComp.current.reconfigure(showLineNumbers ? lineNumbers() : []),
    });
  }, [showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapComp.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: tabSizeComp.current.reconfigure(EditorState.tabSize.of(tabSize)),
    });
  }, [tabSize]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      openFind: () => {
        // search panel: TODO
      },
      getScrollFraction: () => {
        const v = viewRef.current;
        if (!v) return 0;
        const s = v.scrollDOM;
        const max = s.scrollHeight - s.clientHeight;
        return max > 0 ? s.scrollTop / max : 0;
      },
      setScrollFraction: (f) => {
        const v = viewRef.current;
        if (!v) return;
        const s = v.scrollDOM;
        const max = s.scrollHeight - s.clientHeight;
        s.scrollTop = max * Math.max(0, Math.min(1, f));
      },
      goToLine: (line) => {
        const v = viewRef.current;
        if (!v) return;
        const ln = Math.max(1, Math.min(line + 1, v.state.doc.lines));
        const pos = v.state.doc.line(ln).from;
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        v.focus();
      },

      getCursorLine: () => {
        const v = viewRef.current;
        if (!v) return 1;
        const pos = v.state.selection.main.head;
        return v.state.doc.lineAt(pos).number;
      },

      getTopVisibleLine: () => {
        const v = viewRef.current;
        if (!v) return 1;
        // 取 scrollDOM 顶部 + 1 像素处的位置 → 找该位置的行号
        const scrollEl = v.scrollDOM;
        const topAbs = scrollEl.getBoundingClientRect().top + 1;
        // 找到第一个 >= topAbs 的 block DOM 元素
        const blocks = scrollEl.querySelectorAll<HTMLElement>('.cm-line');
        for (const b of blocks) {
          const r = b.getBoundingClientRect();
          if (r.top >= topAbs) {
            // 该 block 内的 text 节点开始位置 → 算 line
            // CodeMirror 把每行包在 .cm-line 里，line block 数量 = doc line 数量
            // 用一个简单的"遍历 doc lines 看哪个 top 最接近"算法
            const lineBlocks = scrollEl.querySelectorAll<HTMLElement>('.cm-line');
            for (let i = 0; i < lineBlocks.length; i++) {
              const rb = lineBlocks[i].getBoundingClientRect();
              if (rb.top >= topAbs) return i + 1;
            }
            return 1;
          }
        }
        return 1;
      },

      appendChunk: (chunk) => {
        const v = viewRef.current;
        if (!v || !chunk) return;
        const len = v.state.doc.length;
        v.dispatch({
          changes: { from: len, insert: chunk },
          // 不滚动，让浏览器 / 用户保持当前位置
        });
      },

      clearDoc: () => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: '' },
        });
      },

      getDoc: () => {
        const v = viewRef.current;
        if (!v) return '';
        return v.state.doc.toString();
      },

      // ---- MD 格式化能力（供 FormatToolbar 调用）----
      wrapSelection: (before, after, placeholder) => {
        const v = viewRef.current;
        if (!v) return;
        const a = after ?? before;
        const sel = v.state.selection.main;
        const ph = placeholder ?? '';
        if (sel.empty) {
          // 没选区：插入 before + placeholder + after，选中 placeholder 让用户接着打
          const insert = before + ph + a;
          const cursorFrom = sel.from + before.length;
          const cursorTo = cursorFrom + ph.length;
          v.dispatch({
            changes: { from: sel.from, insert },
            selection: { anchor: cursorFrom, head: cursorTo },
            userEvent: 'input.format',
          });
        } else {
          // 有选区：包裹起来，并保持原选区在包裹后还是被选中（这样再点一次能"反包裹"）
          const txt = v.state.sliceDoc(sel.from, sel.to);
          v.dispatch({
            changes: { from: sel.from, to: sel.to, insert: before + txt + a },
            selection: { anchor: sel.from + before.length, head: sel.from + before.length + txt.length },
            userEvent: 'input.format',
          });
        }
        v.focus();
      },

      linePrefix: (prefix) => {
        const v = viewRef.current;
        if (!v) return;
        const sel = v.state.selection.main;
        const startLine = v.state.doc.lineAt(sel.from);
        const endLine = v.state.doc.lineAt(sel.to);
        // CodeMirror 要求 changes 按位置升序；我们从上往下逐行加前缀，天然有序
        const changes: { from: number; insert: string }[] = [];
        for (let i = startLine.number; i <= endLine.number; i++) {
          const line = v.state.doc.line(i);
          changes.push({ from: line.from, insert: prefix });
        }
        // 选区跟着移动：每加一次前缀就往后挪 prefix.length
        const delta = prefix.length * (endLine.number - startLine.number + 1);
        v.dispatch({
          changes,
          selection: { anchor: sel.from + prefix.length, head: sel.to + delta },
          userEvent: 'input.format',
        });
        v.focus();
      },

      insertBlock: (template, cursorOffset, selectEndOffset) => {
        const v = viewRef.current;
        if (!v) return;
        const sel = v.state.selection.main;
        const from = sel.from;
        const to = sel.to;
        // 把光标放在 from + cursorOffset
        const cursorFrom = from + Math.max(0, Math.min(cursorOffset, template.length));
        const cursorHead = selectEndOffset != null
          ? from + Math.max(cursorFrom - from, Math.min(selectEndOffset, template.length))
          : cursorFrom;
        v.dispatch({
          changes: { from, to, insert: template },
          selection: { anchor: cursorFrom, head: cursorHead },
          effects: EditorView.scrollIntoView(cursorFrom, { y: 'nearest' }),
          userEvent: 'input.format',
        });
        v.focus();
      },
    }),
    [],
  );

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
});
