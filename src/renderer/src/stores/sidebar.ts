import { create } from 'zustand';

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
};

type SidebarState = {
  root: string | null;
  entries: FsEntry[];
  expanded: Set<string>;
  loading: boolean;
  error: string | null;
  openFolder: (path: string) => Promise<void>;
  toggleExpand: (path: string) => Promise<void>;
  close: () => void;
  childrenOf: (path: string) => Promise<FsEntry[]>;
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  root: null,
  entries: [],
  expanded: new Set(),
  loading: false,
  error: null,

  openFolder: async (path) => {
    set({ root: path, loading: true, error: null });
    const r = await window.api.readDir(path);
    if (r.ok) {
      set({ entries: r.items as FsEntry[], loading: false });
    } else {
      set({ error: r.error ?? '读取失败', loading: false });
    }
  },

  childrenOf: async (path) => {
    const r = await window.api.readDir(path);
    return r.ok ? (r.items as FsEntry[]) : [];
  },

  toggleExpand: async (path) => {
    const expanded = new Set(get().expanded);
    if (expanded.has(path)) {
      expanded.delete(path);
      set({ expanded });
    } else {
      expanded.add(path);
      set({ expanded });
    }
  },

  close: () => set({ root: null, entries: [], expanded: new Set(), error: null }),
}));
