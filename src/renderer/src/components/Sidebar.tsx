import React, { useState } from 'react';
import { FolderOpen, ChevronRight, ChevronDown, FileText, Folder } from 'lucide-react';
import { useSidebarStore, type FsEntry } from '../stores/sidebar';
import { useEditorStore } from '../stores/editor';
import { openFolder } from '../utils/fileOps';

export const Sidebar: React.FC = () => {
  const root = useSidebarStore((s) => s.root);
  const open = root ? useSidebarStore.getState().openFolder : null;

  if (!root) {
    return (
      <aside className="sidebar empty">
        <div className="sidebar-empty">
          <FolderOpen size={32} />
          <p>未打开文件夹</p>
          <button className="btn" onClick={() => openFolder()}>打开文件夹</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <RootHeader />
      <div className="sidebar-tree">
        <Tree path={root} depth={0} />
      </div>
    </aside>
  );
};

const RootHeader: React.FC = () => {
  const root = useSidebarStore((s) => s.root);
  const close = useSidebarStore((s) => s.close);
  return (
    <div className="sidebar-header">
      <span className="sidebar-title" title={root || ''}>
        {root?.split(/[\\/]/).pop() || ''}
      </span>
      <button className="icon-btn" onClick={close} title="关闭文件夹">×</button>
    </div>
  );
};

const Tree: React.FC<{ path: string; depth: number }> = ({ path, depth }) => {
  const entries = useSidebarStore((s) => s.entries);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const expanded = useSidebarStore((s) => s.expanded);
  const isOpen = expanded.has(path);
  const childrenOf = useSidebarStore((s) => s.childrenOf);

  // 如果是 root，用 store 里的 entries；否则用本地 children
  const items = path === useSidebarStore.getState().root ? entries : children;

  const onToggle = async () => {
    if (isOpen) {
      useSidebarStore.getState().toggleExpand(path);
    } else {
      if (!items) {
        const c = await childrenOf(path);
        setChildren(c);
      }
      useSidebarStore.getState().toggleExpand(path);
    }
  };

  return (
    <div>
      <div
        className="tree-item folder"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onToggle}
      >
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={13} className="ic-folder" />
        <span className="tree-name">{path.split(/[\\/]/).pop()}</span>
      </div>
      {isOpen && items?.map((it) => (
        <TreeNode key={it.path} entry={it} depth={depth + 1} />
      ))}
    </div>
  );
};

const TreeNode: React.FC<{ entry: FsEntry; depth: number }> = ({ entry, depth }) => {
  const expanded = useSidebarStore((s) => s.expanded);
  const isOpen = expanded.has(entry.path);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const childrenOf = useSidebarStore((s) => s.childrenOf);
  const openFile = useEditorStore((s) => s.openFile);

  if (entry.isDirectory) {
    const onClick = async () => {
      if (isOpen) {
        useSidebarStore.getState().toggleExpand(entry.path);
      } else {
        if (!children) {
          const c = await childrenOf(entry.path);
          setChildren(c);
        }
        useSidebarStore.getState().toggleExpand(entry.path);
      }
    };
    return (
      <div>
        <div className="tree-item folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={onClick}>
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} className="ic-folder" />
          <span className="tree-name">{entry.name}</span>
        </div>
        {isOpen && children?.map((c) => (
          <TreeNode key={c.path} entry={c} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (entry.isMarkdown) {
    return (
      <div
        className="tree-item file md"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={async () => {
          const r = await window.api.readFile(entry.path);
          if (r.ok) openFile(entry.path, r.content);
        }}
      >
        <FileText size={13} className="ic-md" />
        <span className="tree-name">{entry.name}</span>
      </div>
    );
  }

  return (
    <div className="tree-item file" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="tree-name">{entry.name}</span>
    </div>
  );
};
