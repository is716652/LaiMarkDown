import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Search } from 'lucide-react';
import { useEditorStore } from '../stores/editor';
import { useThemeStore } from '../stores/theme';
import { useSettingsStore } from '../stores/settings';
import { openFile, saveActiveFile, openFolder } from '../utils/fileOps';

type Item = {
  id: string;
  label: string;
  description?: string;
  group?: string;
  shortcut?: string;
  action: () => void;
};

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: Item[] = useMemo(() => {
    const list: Item[] = [
      { id: 'file.new', label: '新建文件', group: '文件', shortcut: 'Ctrl+N', action: () => useEditorStore.getState().newTab() },
      { id: 'file.open', label: '打开文件...', group: '文件', shortcut: 'Ctrl+O', action: () => openFile() },
      { id: 'file.openFolder', label: '打开文件夹...', group: '文件', shortcut: 'Ctrl+Shift+O', action: () => openFolder() },
      { id: 'file.save', label: '保存', group: '文件', shortcut: 'Ctrl+S', action: () => saveActiveFile() },
      { id: 'view.editor', label: '仅编辑', group: '视图', action: () => useEditorStore.getState().setViewMode('editor') },
      { id: 'view.preview', label: '仅预览', group: '视图', action: () => useEditorStore.getState().setViewMode('preview') },
      { id: 'view.splitH', label: '左右分栏', group: '视图', action: () => useEditorStore.getState().setViewMode('split-h') },
      { id: 'view.splitV', label: '上下分栏', group: '视图', action: () => useEditorStore.getState().setViewMode('split-v') },
      { id: 'view.swap', label: '互换编辑/预览', group: '视图', action: () => useEditorStore.getState().setSplitSwap(!useEditorStore.getState().splitSwap) },
      { id: 'view.sidebar', label: '切换侧边栏', group: '视图', shortcut: 'Ctrl+B', action: () => useEditorStore.getState().toggleSidebar() },
      { id: 'view.theme', label: '切换主题', group: '视图', action: () => useThemeStore.getState().cycle() },
      { id: 'view.themeLight', label: '浅色主题', group: '主题', action: () => useThemeStore.getState().setTheme('light') },
      { id: 'view.themeDark', label: '深色主题', group: '主题', action: () => useThemeStore.getState().setTheme('dark') },
      { id: 'view.themeSystem', label: '跟随系统主题', group: '主题', action: () => useThemeStore.getState().setTheme('system') },
      { id: 'set.fontUp', label: '增大字号', group: '设置', action: () => useSettingsStore.getState().set({ fontSize: Math.min(28, useSettingsStore.getState().fontSize + 1) }) },
      { id: 'set.fontDown', label: '减小字号', group: '设置', action: () => useSettingsStore.getState().set({ fontSize: Math.max(10, useSettingsStore.getState().fontSize - 1) }) },
      { id: 'set.toggleLineNum', label: '切换行号', group: '设置', action: () => useSettingsStore.getState().set({ lineNumbers: !useSettingsStore.getState().lineNumbers }) },
      { id: 'set.toggleWrap', label: '切换自动换行', group: '设置', action: () => useSettingsStore.getState().set({ wordWrap: !useSettingsStore.getState().wordWrap }) },
      { id: 'export.pdf', label: '导出为 PDF', group: '导出', action: () => import('../utils/exportRunner').then((m) => m.runExport('pdf')) },
      { id: 'export.html', label: '导出为 HTML', group: '导出', action: () => import('../utils/exportRunner').then((m) => m.runExport('html')) },
    ];
    return list;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('app:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('app:open-command-palette', onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || (i.description?.toLowerCase().includes(q)) || (i.group?.toLowerCase().includes(q)));
  }, [query, items]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[idx]; if (it) { it.action(); setOpen(false); } }
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIdx(0); }}
            onKeyDown={onKey}
            placeholder="输入命令..."
            className="palette-input"
          />
        </div>
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">无匹配命令</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.id}
                className={`palette-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => { it.action(); setOpen(false); }}
              >
                <span className="palette-label">{it.label}</span>
                {it.group && <span className="palette-group">{it.group}</span>}
                {it.shortcut && <span className="palette-shortcut">{it.shortcut}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
