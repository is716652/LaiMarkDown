import { create } from 'zustand';
import { useSettingsStore } from './settings';

export type Theme = 'light' | 'dark' | 'system';

type ThemeState = {
  /** 当前实际生效：light / dark */
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  cycle: () => void;
};

const resolveTheme = (t: Theme): 'light' | 'dark' => {
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
};

const applyToDom = (resolved: 'light' | 'dark') => {
  document.documentElement.dataset.theme = resolved;
};

// Theme 实际值从 settings store 读（持久化）
// 这里只放运行时 resolved + 操作方法
export const useThemeStore = create<ThemeState>((set, get) => ({
  resolved: 'light',

  setTheme: (t) => {
    const resolved = resolveTheme(t);
    applyToDom(resolved);
    useSettingsStore.getState().set({ theme: t });
    set({ resolved });
  },

  cycle: () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const cur = useSettingsStore.getState().theme;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    get().setTheme(next);
  },
}));

// 监听系统主题变化（仅在 theme='system' 时响应）
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    const s = useSettingsStore.getState();
    if (s.theme === 'system') {
      const resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyToDom(resolved);
      useThemeStore.setState({ resolved });
    }
  });
  // 初始主题应用（等 settings 加载完会重新应用；这里先用一个安全默认）
  applyToDom('light');
}

/** App 启动后：等 settings 加载完，把 settings.theme 同步到 theme store */
export function syncThemeFromSettings() {
  const s = useSettingsStore.getState();
  if (!s.loaded) return false;
  const resolved = resolveTheme(s.theme);
  applyToDom(resolved);
  useThemeStore.setState({ resolved });
  return true;
}
