import React, { useState, useRef, useEffect } from 'react';
import { FilePlus, FolderOpen, Save, FileDown, Search, Command, PanelLeft, Sun, Moon, Monitor, FileText, FileCode, FileType, Sparkles } from 'lucide-react';
import { useEditorStore } from '../stores/editor';
import { useThemeStore } from '../stores/theme';
import { useSettingsStore } from '../stores/settings';
import { openFile, saveActiveFile } from '../utils/fileOps';
import { runExport } from '../utils/exportRunner';

export const Toolbar: React.FC = () => {
  const sidebarOpen = useEditorStore((s) => s.sidebarOpen);
  const toggleSidebar = useEditorStore((s) => s.toggleSidebar);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  // theme 持久化在 settings store 里（value of `theme`）
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<HTMLDivElement>(null);

  // LLM 配置
  const llmApiKey = useSettingsStore((s) => s.llmApiKey);
  const llmBaseUrl = useSettingsStore((s) => s.llmBaseUrl);
  const llmModel = useSettingsStore((s) => s.llmModel);
  const setSettings = useSettingsStore((s) => s.set);

  // click outside to close export menu
  useEffect(() => {
    if (!exportOpen) return;
    const onClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [exportOpen]);

  // click outside to close AI menu
  useEffect(() => {
    if (!aiOpen) return;
    const onClick = (e: MouseEvent) => {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) {
        setAiOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [aiOpen]);

  // listen to keyboard
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="tb-btn" title="新建" onClick={() => useEditorStore.getState().newTab()}>
          <FilePlus size={16} />
        </button>
        <button className="tb-btn" title="打开文件" onClick={() => openFile()}>
          <FolderOpen size={16} />
        </button>
        <button className="tb-btn" title="保存" onClick={() => saveActiveFile()}>
          <Save size={16} />
        </button>
        <span className="tb-sep" />
        <div className="export-wrap" ref={exportRef}>
          <button
            className="tb-btn"
            title="导出"
            onClick={() => setExportOpen((o) => !o)}
          >
            <FileDown size={16} />
          </button>
          {exportOpen && (
            <div className="export-menu">
              <button className="export-item" onClick={() => { setExportOpen(false); void runExport('pdf'); }}>
                <FileText size={14} /> <span>导出为 PDF</span>
              </button>
              <button className="export-item" onClick={() => { setExportOpen(false); void runExport('html'); }}>
                <FileCode size={14} /> <span>导出为 HTML</span>
              </button>
              <button className="export-item" onClick={() => { setExportOpen(false); void runExport('docx'); }}>
                <FileType size={14} /> <span>导出为 Word (.docx)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-group center">
        <div className="seg">
          {(['editor', 'split-h', 'split-v', 'preview'] as const).map((m) => (
            <button
              key={m}
              className={`seg-btn ${viewMode === m ? 'active' : ''}`}
              onClick={() => setViewMode(m)}
              title={
                m === 'editor' ? '仅编辑' :
                m === 'preview' ? '仅预览' :
                m === 'split-h' ? '左右分栏' : '上下分栏'
              }
            >
              {m === 'editor' ? '编辑' : m === 'preview' ? '预览' : m === 'split-h' ? '左右' : '上下'}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-group right">
        <div className="export-wrap" ref={aiRef}>
          <button
            className="tb-btn"
            title="AI 排版设置"
            onClick={() => setAiOpen((o) => !o)}
          >
            <Sparkles size={16} style={{ opacity: llmApiKey ? 1 : 0.5 }} />
          </button>
          {aiOpen && (
            <div className="ai-menu">
              <div className="ai-form">
                <div className="ai-label">API Key</div>
                <input
                  className="ai-input"
                  type="password"
                  placeholder="sk-..."
                  value={llmApiKey}
                  onChange={(e) => setSettings({ llmApiKey: e.target.value })}
                  autoComplete="off"
                />
                <div className="ai-label">Base URL</div>
                <input
                  className="ai-input"
                  type="text"
                  placeholder="https://api.deepseek.com"
                  value={llmBaseUrl}
                  onChange={(e) => setSettings({ llmBaseUrl: e.target.value })}
                />
                <div className="ai-label">Model</div>
                <select
                  className="ai-input ai-select"
                  value={llmModel}
                  onChange={(e) => setSettings({ llmModel: e.target.value })}
                >
                  <option value="deepseek-v4-flash">deepseek-v4-flash（推荐：快+便宜）</option>
                  <option value="deepseek-v4-pro">deepseek-v4-pro（最强）</option>
                </select>
                <div className="ai-hint">
                  配置后，拖入 .txt 文件到窗口任意位置即可调用 AI 自动排版为 Markdown。<br />
                  旧版 <code>deepseek-chat</code> / <code>deepseek-reasoner</code> 将于 2026/07/24 弃用。
                </div>
              </div>
            </div>
          )}
        </div>
        <span className="tb-sep" />
        <button className="tb-btn" title="侧边栏" onClick={toggleSidebar}>
          <PanelLeft size={16} style={{ opacity: sidebarOpen ? 1 : 0.5 }} />
        </button>
        <button
          className="tb-btn"
          title="主题"
          onClick={() => {
            const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
            setTheme(order[(order.indexOf(theme) + 1) % order.length]);
          }}
        >
          {theme === 'light' ? <Sun size={16} /> : theme === 'dark' ? <Moon size={16} /> : <Monitor size={16} />}
        </button>
        <button className="tb-btn cmd" title="命令面板 (Ctrl+Shift+P)" onClick={() => setPaletteOpen(true)}>
          <Command size={16} />
        </button>
      </div>

      {paletteOpen && <PaletteOverlay onClose={() => setPaletteOpen(false)} />}
    </div>
  );
};

// Lazy palette overlay - inline to avoid extra file
const PaletteOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // delegate to global CommandPalette
  React.useEffect(() => {
    const ev = new CustomEvent('app:open-command-palette');
    window.dispatchEvent(ev);
    onClose();
  }, [onClose]);
  return null;
};
