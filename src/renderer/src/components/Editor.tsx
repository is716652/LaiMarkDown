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
    }),
    [],
  );

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
});
