/// <reference types="vite/client" />

import type { LaiApi as _LaiApi } from '../../preload';

declare global {
  interface Window {
    api: _LaiApi & {
      exportPDF?: (opts: { html: string; savePath?: string; defaultName?: string }) => Promise<
        { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }
      >;
    };
  }
}

export {};
