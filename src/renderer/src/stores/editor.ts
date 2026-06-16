// ---------- Editor Store ----------
export type Tab = {
  id: string;
  filePath: string | null;   // null = unsaved
  title: string;
  content: string;
  dirty: boolean;
};

export type ViewMode = 'editor' | 'preview' | 'split-h' | 'split-v';
export type Theme = 'light' | 'dark' | 'system';

type EditorState = {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  viewMode: ViewMode;
  splitSwap: boolean;        // swap editor/preview pane
  showEditor: boolean;
  showPreview: boolean;
  splitHorizontal: boolean;
};

type EditorActions = {
  newTab: () => string;
  openFile: (filePath: string, content: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  setViewMode: (m: ViewMode) => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  setSplitSwap: (v: boolean) => void;
  activeTab: () => Tab | undefined;
};

import { create } from 'zustand';

let tabCounter = 0;
const newId = () => `tab-${Date.now()}-${++tabCounter}`;

const initialTabs: Tab[] = [];
const firstTab: Tab = {
  id: newId(),
  filePath: null,
  title: '未命名',
  content: '',
  dirty: false,
};
initialTabs.push(firstTab);

export const useEditorStore = create<EditorState & EditorActions>((set, get) => ({
  tabs: initialTabs,
  activeTabId: firstTab.id,
  sidebarOpen: true,
  viewMode: 'split-h',
  splitSwap: false,
  showEditor: true,
  showPreview: true,
  splitHorizontal: true,

  activeTab: () => get().tabs.find((t) => t.id === get().activeTabId),

  newTab: () => {
    const id = newId();
    set((s) => ({
      tabs: [...s.tabs, { id, filePath: null, title: '未命名', content: '', dirty: false }],
      activeTabId: id,
    }));
    return id;
  },

  openFile: (filePath, content) => {
    const existing = get().tabs.find((t) => t.filePath === filePath);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = newId();
    const title = filePath.split(/[\\/]/).pop() || '未命名';
    set((s) => ({
      tabs: [...s.tabs, { id, filePath, title, content, dirty: false }],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? null;
      }
      if (tabs.length === 0) {
        const fresh: Tab = { id: newId(), filePath: null, title: '未命名', content: '', dirty: false };
        tabs.push(fresh);
        activeTabId = fresh.id;
      }
      return { tabs, activeTabId };
    });
  },

  setActive: (id) => set({ activeTabId: id }),

  updateContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
    }));
  },

  markSaved: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty: false } : t)),
    }));
  },

  setViewMode: (m) => {
    const flags = {
      editor: { showEditor: true, showPreview: false, splitHorizontal: true },
      preview: { showEditor: false, showPreview: true, splitHorizontal: true },
      'split-h': { showEditor: true, showPreview: true, splitHorizontal: true },
      'split-v': { showEditor: true, showPreview: true, splitHorizontal: false },
    }[m];
    set({ viewMode: m, ...flags });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleTheme: () => {
    // delegate to theme store
    import('./theme').then(({ useThemeStore }) => {
      useThemeStore.getState().cycle();
    });
  },
  setSplitSwap: (v) => set({ splitSwap: v }),
}));
