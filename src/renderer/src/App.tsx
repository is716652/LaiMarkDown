import React, { useEffect, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { Editor, type EditorHandle } from './components/Editor';
import { Preview, type PreviewHandle } from './components/Preview';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { FormatToolbar } from './components/FormatToolbar';
import { useEditorStore } from './stores/editor';
import { useThemeStore } from './stores/theme';
import { useSettingsStore } from './stores/settings';
import { useAiStore } from './stores/ai';
import './styles/layout.css';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

export const App: React.FC = () => {
  const viewMode = useEditorStore((s) => s.viewMode);
  const sidebarOpen = useEditorStore((s) => s.sidebarOpen);
  const showEditor = useEditorStore((s) => s.showEditor);
  const showPreview = useEditorStore((s) => s.showPreview);
  const splitSwap = useEditorStore((s) => s.splitSwap);
  const splitRatio = useSettingsStore((s) => s.splitRatio);
  const workAreaRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const previewRef = useRef<PreviewHandle | null>(null);

  // AI 排版状态（暴露给 StatusBar 显示）
  const setAiFormatting = useAiStore((s) => s.setFormatting);
  const setAiError = useAiStore((s) => s.setError);

  // 监听 drop：处理拖入的 .txt → AI 排版
  const onDragOver = (e: React.DragEvent) => {
    // 仅当有文件时拦截（避免拦截其他元素的拖拽）
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    // 必须是 .txt
    if (!/\.txt$/i.test(file.name)) {
      setAiError('只支持 .txt 文件');
      setTimeout(() => setAiError(null), 3000);
      return;
    }
    const filePath = window.api.getPathForFile(file);
    if (!filePath) {
      setAiError('无法获取文件路径');
      setTimeout(() => setAiError(null), 3000);
      return;
    }
    // 读 LLM 配置
    const cfg = useSettingsStore.getState();
    if (!cfg.llmApiKey) {
      setAiError('请先在工具栏 ✨ AI 按钮里配置 API Key');
      setTimeout(() => setAiError(null), 4000);
      return;
    }
    // 开始排版
    setAiFormatting({ fileName: file.name });
    setAiError(null);
    try {
      const result = await window.api.formatTxt(filePath, {
        apiKey: cfg.llmApiKey,
        baseUrl: cfg.llmBaseUrl,
        model: cfg.llmModel,
      });
      if (!result.ok) {
        setAiError(`AI 排版失败：${result.error}`);
        setTimeout(() => setAiError(null), 6000);
        return;
      }
      // 新建 tab 显示结果
      const editorState = useEditorStore.getState();
      const newId = editorState.newTab();
      // 改 title + content
      useEditorStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === newId
            ? { ...t, title: file.name.replace(/\.txt$/i, '') + ' (AI 排版)', content: result.content, dirty: true }
            : t
        ),
      }));
    } catch (err) {
      setAiError('AI 排版异常：' + (err as Error).message);
      setTimeout(() => setAiError(null), 6000);
    } finally {
      setAiFormatting(null);
    }
  };

  // 滚动同步：仅在 split 模式下启用
  // 滚动同步：仅在 split 模式下启用
  useEffect(() => {
    if (viewMode !== 'split-h' && viewMode !== 'split-v') return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    // 切 tab 期间冻结滚动同步：preview 内容异步回填（Prism worker / Mermaid）会让 preview.scrollTop 短暂归零，
    // 如果同步逻辑不冻结，会把 editor 一起拉回 0。frozen 期内 tick 不动。
    let frozenUntil = 0;
    let lastTabId = useEditorStore.getState().activeTabId;
    const unsub = useEditorStore.subscribe((s) => {
      if (s.activeTabId !== lastTabId) {
        lastTabId = s.activeTabId;
        frozenUntil = Date.now() + 600; // 600ms 足够 Prism + Mermaid + 图片跑完
      }
    });

    // 防循环：source 是哪个，set 另一个 → set 之后，下次轮询检测到两端已同步就不动
    let lastE = -1;
    let lastP = -1;
    let source: 'editor' | 'preview' | null = null;
    let rafId = 0;
    const tick = () => {
      if (Date.now() < frozenUntil) {
        // 冻结期间：重置 lastE/lastP 防止冻结结束时把"残留差"当成 source 触发
        lastE = editor.getScrollFraction();
        lastP = preview.getScrollFraction();
        rafId = requestAnimationFrame(tick);
        return;
      }
      const ef = editor.getScrollFraction();
      const pf = preview.getScrollFraction();

      // 哪边变化大哪边是 source（带 0.001 阈值防抖）
      const dE = Math.abs(ef - lastE);
      const dP = Math.abs(pf - lastP);
      if (source === null) {
        if (dE > 0.001) {
          source = 'editor';
          preview.setScrollFraction(ef);
          lastP = preview.getScrollFraction(); // 同步
        } else if (dP > 0.001) {
          source = 'preview';
          editor.setScrollFraction(pf);
          lastE = editor.getScrollFraction();
        }
      } else {
        // 等下一次两端都"跟上了"才释放 source（用接近 lastX 判断）
        const settledE = Math.abs(ef - lastE) < 0.0005;
        const settledP = Math.abs(pf - lastP) < 0.0005;
        if (settledE && settledP) {
          source = null;
        } else if (source === 'editor' && !settledE) {
          preview.setScrollFraction(ef);
          lastP = preview.getScrollFraction();
        } else if (source === 'preview' && !settledP) {
          editor.setScrollFraction(pf);
          lastE = editor.getScrollFraction();
        }
      }
      lastE = ef;
      lastP = pf;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsub();
    };
  }, [viewMode, showEditor, showPreview]);

  // Bootstrap theme
  useEffect(() => {
    useThemeStore.getState().setTheme(useThemeStore.getState().theme);
  }, []);

  // 把 splitRatio 同步到 CSS 变量（启动 / 外部变更时）
  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;
    el.style.setProperty('--split-ratio', String(splitRatio));
  }, [splitRatio]);

  // App-level menu events (from main process)
  useEffect(() => {
    const off = window.api.onMenu('menu:view-mode', (m) => {
      useEditorStore.getState().setViewMode(m as 'editor' | 'preview' | 'split-h' | 'split-v');
    });
    const offSwap = window.api.onMenu('menu:swap-panes', () => {
      useEditorStore.getState().setSplitSwap(!useEditorStore.getState().splitSwap);
    });
    const offSidebar = window.api.onMenu('menu:toggle-sidebar', () => {
      useEditorStore.getState().toggleSidebar();
    });
    const offTheme = window.api.onMenu('menu:toggle-theme', () => {
      useEditorStore.getState().toggleTheme();
    });
    return () => {
      off();
      offSwap();
      offSidebar();
      offTheme();
    };
  }, []);

  // splitClass 直接从 viewMode 派生（single 模式不带 split-h/split-v 残留类）
  const splitClass =
    viewMode === 'split-v' ? 'split-v' :
    viewMode === 'split-h' ? 'split-h' : '';

  // 拖拽分隔条 —— 直接操作 DOM CSS 变量，松手才写回 store
  const onDividerMouseDown = (e: React.MouseEvent) => {
    if (viewMode !== 'split-h' && viewMode !== 'split-v') return;
    e.preventDefault();
    const workArea = workAreaRef.current;
    if (!workArea) return;

    const rect = workArea.getBoundingClientRect();
    const isHorizontal = viewMode === 'split-h';
    document.body.classList.add(isHorizontal ? 'dragging-divider' : 'dragging-divider-v');

    const onMove = (ev: MouseEvent) => {
      let ratio: number;
      if (isHorizontal) {
        const x = ev.clientX - rect.left;
        ratio = x / rect.width;
      } else {
        const y = ev.clientY - rect.top;
        ratio = y / rect.height;
      }
      ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
      workArea.style.setProperty('--split-ratio', String(ratio));
      // 用 ref 存最新值，松手时取
      (workArea as any).__pendingRatio = ratio;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging-divider');
      document.body.classList.remove('dragging-divider-v');
      const r = (workArea as any).__pendingRatio as number | undefined;
      if (typeof r === 'number') {
        useSettingsStore.getState().set({ splitRatio: r });
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="app-root"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TitleBar />
      <Toolbar />
      <div className="app-body">
        {sidebarOpen && <Sidebar />}
        <main className="app-main">
          <TabBar />
          <div
            ref={workAreaRef}
            className={`work-area ${splitClass} ${viewMode === 'split-h' || viewMode === 'split-v' ? 'split' : 'single'} ${splitSwap ? 'swapped' : ''}`}
          >
            {/* Editor/Preview 始终挂载（不条件渲染），用 display 切换可见性。
                这样切 tab 时不会 unmount → 滚动位置、光标、滚动同步状态全部保留。 */}
            <section
              className="pane pane-editor"
              style={{ display: showEditor ? '' : 'none' }}
            >
              <FormatToolbar editorRef={editorRef} />
              <div className="editor-content">
                <Editor ref={editorRef} />
              </div>
            </section>
            {showEditor && showPreview && (
              <div className="pane-divider" onMouseDown={onDividerMouseDown} title="拖动调整宽度" />
            )}
            <section
              className="pane pane-preview"
              style={{ display: showPreview ? '' : 'none' }}
            >
              <Preview ref={previewRef} />
            </section>
          </div>
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
};
