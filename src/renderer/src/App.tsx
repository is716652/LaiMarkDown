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
import { useThemeStore, syncThemeFromSettings } from './stores/theme';
import { useSettingsStore } from './stores/settings';
import { useAiStore } from './stores/ai';
import { openFile } from './utils/fileOps';
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

  // 滚动同步（行级）：仅在 split 模式下启用
  // - 编辑器滚动 → 拿到视口顶部行号 → preview.scrollToSourceLine
  // - 预览滚动 → 拿 anchors（每个 block 的源行号）→ 找最靠近 scrollTop 的 anchor →
  //   editor.scrollToSourceLine（**只滚视图不动 selection**，避免用户输 MD 标记时
  //   滚动同步把光标拉到行首）
  // - 冻结期：切 tab 期间不触发（preview 内容异步回填会让 scrollTop 跳变）
  useEffect(() => {
    if (viewMode !== 'split-h' && viewMode !== 'split-v') return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    // 切 tab 期间冻结滚动同步
    let frozenUntil = 0;
    let lastTabId = useEditorStore.getState().activeTabId;
    const unsub = useEditorStore.subscribe((s) => {
      if (s.activeTabId !== lastTabId) {
        lastTabId = s.activeTabId;
        frozenUntil = Date.now() + 800; // 800ms 覆盖 prism + mermaid + 行号注入
      }
    });

    // 行级同步：跟踪上一次 set 的源行号 / preview scrollTop，避免循环
    let lastEditorLine = -1;
    let lastPreviewTop = -1;
    let source: 'editor' | 'preview' | null = null;

    const tick = () => {
      if (Date.now() < frozenUntil) {
        lastEditorLine = editor.getTopVisibleLine();
        lastPreviewTop = preview.getBlockAnchors()[0]?.top ?? -1;
        requestAnimationFrame(tick);
        return;
      }

      const editorLine = editor.getTopVisibleLine();
      const previewTop = preview.getBlockAnchors()[0]?.top ?? -1;

      if (source === null) {
        // 哪边变化大哪边是 source
        const dE = Math.abs(editorLine - lastEditorLine);
        const dP = Math.abs(previewTop - lastPreviewTop);
        if (dE > 0 && dE >= dP) {
          source = 'editor';
          preview.scrollToSourceLine(editorLine);
          lastPreviewTop = preview.getBlockAnchors()[0]?.top ?? -1;
        } else if (dP > 2) {
          source = 'preview';
          // 找到 preview.scrollTop 对应最近的 anchor → 用它的 source line
          const anchors = preview.getBlockAnchors();
          if (anchors.length > 0) {
            const scrollTop = preview.getScrollTop();
            // 找第一个 top > scrollTop 的 anchor → 用它前一个
            let target = anchors[0];
            for (let i = 0; i < anchors.length; i++) {
              if (anchors[i].top <= scrollTop + 10) target = anchors[i];
              else break;
            }
            // 只滚视图不动 selection（用户主动滚 preview 时编辑器只跟随滚视图，光标保持原位）
            editor.scrollToSourceLine(target.line);
            lastEditorLine = editor.getTopVisibleLine();
          }
        }
      } else {
        // 等下一次两端都"跟上了"才释放 source
        const settledE = Math.abs(editorLine - lastEditorLine) < 1;
        const settledP = Math.abs(previewTop - lastPreviewTop) < 4;
        if (settledE && settledP) {
          source = null;
        } else if (source === 'editor' && !settledE) {
          preview.scrollToSourceLine(editorLine);
          lastPreviewTop = preview.getBlockAnchors()[0]?.top ?? -1;
        } else if (source === 'preview' && !settledP) {
          const anchors = preview.getBlockAnchors();
          if (anchors.length > 0) {
            const scrollTop = preview.getScrollTop();
            let target = anchors[0];
            for (let i = 0; i < anchors.length; i++) {
              if (anchors[i].top <= scrollTop + 10) target = anchors[i];
              else break;
            }
            // 只滚视图不动 selection
            editor.scrollToSourceLine(target.line);
            lastEditorLine = editor.getTopVisibleLine();
          }
        }
      }
      lastEditorLine = editorLine;
      lastPreviewTop = previewTop;
      requestAnimationFrame(tick);
    };

    const rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      unsub();
    };
  }, [viewMode, showEditor, showPreview]);

  // Bootstrap theme：等 settings 加载完成后，把 settings.theme 同步到 theme store
  // （loaded 由 false 变 true 触发；初次 mount 时 loaded=false 不执行）
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  useEffect(() => {
    if (!settingsLoaded) return;
    syncThemeFromSettings();
  }, [settingsLoaded]);

  // 把 splitRatio 同步到 CSS 变量（启动 / 外部变更时）
  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;
    el.style.setProperty('--split-ratio', String(splitRatio));
  }, [splitRatio]);

  // App-level menu events (from main process)
  useEffect(() => {
    // 把当前 editor handle 暴露到 window（供 fileOps 流式打开时拿 appendChunk/clearDoc）
    (window as any).__currentEditorHandle = editorRef.current;
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
    // 资源管理器右键 → 打开方式 → 来 MarkDown：
    // 主进程拿到文件路径后通过这个 channel 推过来
    const offOpenFromMain = window.api.onMenu(
      'file:open-from-main',
      (paths: unknown) => {
        if (!Array.isArray(paths)) return;
        // 顺序打开：每个文件一个 tab；多文件时聚焦到最后一个
        (async () => {
          for (const p of paths) {
            if (typeof p !== 'string' || !p) continue;
            await openFile(p);
          }
        })();
      },
    );
    return () => {
      off();
      offSwap();
      offSidebar();
      offTheme();
      offOpenFromMain();
    };
  }, []);

  // splitClass 直接从 viewMode 派生（single 模式不带 split-h/split-v 残留类）
  const splitClass =
    viewMode === 'split-v' ? 'split-v' :
    viewMode === 'split-h' ? 'split-h' : '';

  // 预览区点击/双击 → 跳转到 editor 对应行（双击时选中整段）
  const onPreviewBlockClick = (info: { line: number; span: number; mode: 'click' | 'dblclick' }) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (info.mode === 'click') {
      editor.goToLine(info.line);
    } else {
      // dblclick：跳到第一行，光标在第一行；额外选中 [line, line+span) 整段
      editor.goToLine(info.line, { selectSpan: info.span });
    }
    // 用户可能当前在 preview-only 视图 → 自动切到 split 让他看到 editor
    const mode = useEditorStore.getState().viewMode;
    if (mode === 'preview') {
      useEditorStore.getState().setViewMode('split-h');
    }
  };

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
          {/* 工具栏提到 work-area 上方 → 跨整个窗口宽度（左右分栏时不会被预览区挡住）。
              预览模式没有编辑器 → 不显示。 */}
          {viewMode !== 'preview' && <FormatToolbar editorRef={editorRef} />}
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
              <Editor ref={editorRef} />
            </section>
            {showEditor && showPreview && (
              <div className="pane-divider" onMouseDown={onDividerMouseDown} title="拖动调整宽度" />
            )}
            <section
              className="pane pane-preview"
              style={{ display: showPreview ? '' : 'none' }}
            >
              <Preview ref={previewRef} onBlockClick={onPreviewBlockClick} />
            </section>
          </div>
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
};
