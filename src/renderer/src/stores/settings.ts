import { create } from 'zustand';

type SettingsState = {
  fontSize: number;
  editorFontFamily: string;
  previewFontFamily: string;
  lineNumbers: boolean;
  wordWrap: boolean;
  tabSize: number;
  showSidebar: boolean;
  splitRatio: number;          // 编辑器占的分栏比例，0~1
  // LLM 排版配置（API Key 存本地，仅 main 进程使用）
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  set: (patch: Partial<SettingsState>) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  fontSize: 15,
  editorFontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Microsoft YaHei", monospace',
  previewFontFamily: '"Source Han Sans SC", "Microsoft YaHei", -apple-system, sans-serif',
  lineNumbers: true,
  wordWrap: true,
  tabSize: 2,
  showSidebar: true,
  splitRatio: 0.5,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  set: (patch) => set(patch),
}));
