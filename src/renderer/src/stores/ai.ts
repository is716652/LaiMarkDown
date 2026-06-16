import { create } from 'zustand';

// AI 排版全局状态：进度提示 + 错误提示
type AiState = {
  formatting: { fileName: string } | null;
  error: string | null;
  setFormatting: (v: { fileName: string } | null) => void;
  setError: (v: string | null) => void;
};

export const useAiStore = create<AiState>((set) => ({
  formatting: null,
  error: null,
  setFormatting: (v) => set({ formatting: v }),
  setError: (v) => set({ error: v }),
}));
