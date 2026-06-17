import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, ChevronRight, ChevronDown, FileText, Folder, Search, X } from 'lucide-react';
import { useSidebarStore, type FsEntry } from '../stores/sidebar';
import { useEditorStore } from '../stores/editor';
import { openFolder } from '../utils/fileOps';

export const Sidebar: React.FC = () => {
  const root = useSidebarStore((s) => s.root);

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
      <SearchBox />
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

// ---- 文件名搜索 ----
type SearchHit = { name: string; relPath: string; absPath: string; size: number };

const SearchBox: React.FC = () => {
  const root = useSidebarStore((s) => s.root);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openFile = useEditorStore((s) => s.openFile);

  // 防抖 200ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // 触发扫描
  useEffect(() => {
    if (!root) return;
    if (!debounced) {
      setHits(null);
      setIdx(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const r = await window.api.listMdRecursive({ rootDir: root, maxDepth: 6 });
      if (cancelled) return;
      if (r.ok) {
        const q = debounced.toLowerCase();
        setHits(
          r.items.filter(
            (it: SearchHit) => it.name.toLowerCase().includes(q) || it.relPath.toLowerCase().includes(q),
          ),
        );
      } else {
        setHits([]);
      }
      setLoading(false);
      setIdx(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, root]);

  // 键盘上下 + Enter
  const onKey = (e: React.KeyboardEvent) => {
    if (!hits || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[idx];
      if (hit) void openHit(hit);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  const openHit = async (hit: SearchHit) => {
    const r = await window.api.readFile(hit.absPath);
    if (r.ok) {
      openFile(hit.absPath, r.content);
      setQuery('');
    } else {
      alert('打开失败：' + r.error);
    }
  };

  const showResults = query.trim().length > 0;

  return (
    <>
      <div className="sidebar-search">
        <Search size={13} className="sidebar-search-ic" />
        <input
          ref={inputRef}
          className="sidebar-search-input"
          placeholder="搜索文件名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        {query && (
          <button className="sidebar-search-clear" onClick={() => setQuery('')} title="清空">
            <X size={13} />
          </button>
        )}
      </div>
      {showResults && (
        <div className="sidebar-search-results">
          {loading && <div className="sidebar-search-status">搜索中...</div>}
          {!loading && hits && hits.length === 0 && (
            <div className="sidebar-search-status">无匹配文件</div>
          )}
          {!loading && hits && hits.length > 0 && (
            <>
              <div className="sidebar-search-status">{hits.length} 个匹配</div>
              {hits.slice(0, 50).map((h, i) => (
                <div
                  key={h.absPath}
                  className={`sidebar-search-item ${i === idx ? 'active' : ''}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => openHit(h)}
                >
                  <FileText size={12} className="ic-md" />
                  <span className="sidebar-search-name">
                    {h.relPath.split('/').map((seg, j, arr) => (
                      <span key={j} className={j === arr.length - 1 ? 'leaf' : 'dir'}>
                        {seg}
                        {j < arr.length - 1 ? ' / ' : ''}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
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
