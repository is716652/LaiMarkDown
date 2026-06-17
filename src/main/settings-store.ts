/**
 * 用户设置持久化（基于 electron-store）
 *
 * - 写入位置：app.getPath('userData')/settings.json
 * - 字段全部可选；renderer 端负责 schema 校验和默认值兜底
 * - 全量读写：避免增量同步复杂、且设置数据量小（KB 级）
 */
import Store from 'electron-store';
import log from 'electron-log';

/** 设置数据形状。字段全可选；任何坏字段都由 renderer 端过滤回退到默认值。 */
export type PersistedSettings = {
  // 字号 / 字体
  fontSize?: number;
  editorFontFamily?: string;
  previewFontFamily?: string;
  // 编辑器外观
  lineNumbers?: boolean;
  wordWrap?: boolean;
  tabSize?: number;
  // 布局
  showSidebar?: boolean;
  splitRatio?: number;
  // 主题
  theme?: 'light' | 'dark' | 'system';
  // LLM 排版（API Key 放这里用户明确接受）
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
};

let store: Store<PersistedSettings> | null = null;

function getStore(): Store<PersistedSettings> {
  if (!store) {
    store = new Store<PersistedSettings>({
      name: 'settings',
      // 不写默认值 → 第一次启动是空对象，renderer 端兜底
      clearInvalidConfig: true,
    });
  }
  return store;
}

export function loadSettings(): PersistedSettings {
  try {
    return getStore().store;
  } catch (e) {
    log.error('loadSettings failed', e);
    return {};
  }
}

export function saveSettings(patch: PersistedSettings): { ok: boolean; error?: string } {
  try {
    const s = getStore() as any;
    for (const [k, v] of Object.entries(patch)) {
      // 只接受已知字段；其他扔掉（防污染）
      if (!ALLOWED_KEYS.includes(k)) continue;
      if (v === undefined) s.delete(k);
      else s.set(k, v);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 字段白名单 —— 防止 renderer 端误传垃圾字段污染磁盘 */
const ALLOWED_KEYS: readonly string[] = [
  'fontSize',
  'editorFontFamily',
  'previewFontFamily',
  'lineNumbers',
  'wordWrap',
  'tabSize',
  'showSidebar',
  'splitRatio',
  'theme',
  'llmApiKey',
  'llmBaseUrl',
  'llmModel',
];

// 日志（沿用主进程 electron-log）
