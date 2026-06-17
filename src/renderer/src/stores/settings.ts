import { create } from 'zustand';

/**
 * 用户设置 + 持久化
 *
 * - 启动时 main 进程通过 IPC 加载磁盘 settings.json（async）
 * - 每次 set 触发 debounced（500ms）IPC 写盘
 * - 字段白名单 + 类型校验：坏字段回退到默认值（防止 settings.json 被改坏）
 *
 * 注意：theme 也并到这里持久化（theme store 的 setTheme/cycle 桥接过来）
 */

export type SettingsState = {
  // 启动/初始化状态
  loaded: boolean;

  // 字号 / 字体
  fontSize: number;
  editorFontFamily: string;
  previewFontFamily: string;
  // 编辑器外观
  lineNumbers: boolean;
  wordWrap: boolean;
  tabSize: number;
  // 布局
  showSidebar: boolean;
  splitRatio: number; // 编辑器占的分栏比例，0~1
  // 主题
  theme: 'light' | 'dark' | 'system';
  // LLM 排版
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;

  // 行为
  set: (patch: Partial<SettingsState>) => void;
  /** 从磁盘加载（启动时调一次） */
  loadFromDisk: () => Promise<void>;
};

// 默认值（同时充当 schema：每个 key 必须出现在这里，否则 load 阶段会被忽略）
const DEFAULTS = {
  fontSize: 15,
  editorFontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Microsoft YaHei", monospace',
  previewFontFamily: '"Source Han Sans SC", "Microsoft YaHei", -apple-system, sans-serif',
  lineNumbers: true,
  wordWrap: true,
  tabSize: 2,
  showSidebar: true,
  splitRatio: 0.5,
  theme: 'light' as const,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
};

// 字段类型校验器（坏值回退到 default）
function sanitize(input: any): Partial<typeof DEFAULTS> {
  const out: Partial<typeof DEFAULTS> = {};
  if (typeof input?.fontSize === 'number' && input.fontSize >= 10 && input.fontSize <= 32) {
    out.fontSize = input.fontSize;
  }
  if (typeof input?.editorFontFamily === 'string' && input.editorFontFamily.length < 200) {
    out.editorFontFamily = input.editorFontFamily;
  }
  if (typeof input?.previewFontFamily === 'string' && input.previewFontFamily.length < 200) {
    out.previewFontFamily = input.previewFontFamily;
  }
  if (typeof input?.lineNumbers === 'boolean') out.lineNumbers = input.lineNumbers;
  if (typeof input?.wordWrap === 'boolean') out.wordWrap = input.wordWrap;
  if (typeof input?.tabSize === 'number' && [2, 4, 8].includes(input.tabSize)) {
    out.tabSize = input.tabSize;
  }
  if (typeof input?.showSidebar === 'boolean') out.showSidebar = input.showSidebar;
  if (typeof input?.splitRatio === 'number' && input.splitRatio >= 0.15 && input.splitRatio <= 0.85) {
    out.splitRatio = input.splitRatio;
  }
  if (input?.theme === 'light' || input?.theme === 'dark' || input?.theme === 'system') {
    out.theme = input.theme;
  }
  if (typeof input?.llmApiKey === 'string') out.llmApiKey = input.llmApiKey;
  if (typeof input?.llmBaseUrl === 'string' && input.llmBaseUrl.length < 500) {
    out.llmBaseUrl = input.llmBaseUrl;
  }
  if (typeof input?.llmModel === 'string' && input.llmModel.length < 200) {
    out.llmModel = input.llmModel;
  }
  return out;
}

const SAVE_DEBOUNCE_MS = 500;

export const useSettingsStore = create<SettingsState>((set, get) => {
  // ---- 内部：debounce 写盘 ----
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPatch: Record<string, unknown> = {};

  const scheduleSave = (patch: Record<string, unknown>) => {
    pendingPatch = { ...pendingPatch, ...patch };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const toSave = pendingPatch;
      pendingPatch = {};
      saveTimer = null;
      try {
        const r = await window.api.saveSettings(toSave);
        if (!r.ok) console.warn('saveSettings failed:', r.error);
      } catch (e) {
        console.warn('saveSettings threw:', e);
      }
    }, SAVE_DEBOUNCE_MS);
  };

  return {
    loaded: false,

    ...DEFAULTS,

    set: (patch) => {
      set(patch as Partial<SettingsState>);
      // 排掉内部方法（这些不是可持久化字段）
      const persistable: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'loaded' || k === 'set' || k === 'loadFromDisk') continue;
        persistable[k] = v;
      }
      if (Object.keys(persistable).length > 0) scheduleSave(persistable);
    },

    loadFromDisk: async () => {
      try {
        const disk = await window.api.loadSettings();
        const sanitized = sanitize(disk);
        if (Object.keys(sanitized).length > 0) {
          set({ ...sanitized, loaded: true });
        } else {
          set({ loaded: true });
        }
      } catch (e) {
        console.warn('loadSettings threw:', e);
        set({ loaded: true });
      }
    },
  };
});
