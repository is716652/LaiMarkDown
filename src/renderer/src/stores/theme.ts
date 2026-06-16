import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

type ThemeState = {
  /** 用户选择：light / dark / system */
  theme: Theme;
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

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  resolved: 'light',

  setTheme: (t) => {
    const resolved = resolveTheme(t);
    applyToDom(resolved);
    set({ theme: t, resolved });
  },

  cycle: () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const cur = get().theme;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    get().setTheme(next);
  },
}));

// 监听系统主题变化（仅在 theme='system' 时响应）
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    const s = useThemeStore.getState();
    if (s.theme === 'system') s.setTheme('system');
  });
  // 应用初始主题
  applyToDom(useThemeStore.getState().resolved);
}
