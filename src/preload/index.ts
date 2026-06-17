import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  // file system
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:write-file', path, content),
  writeBinaryFile: (path: string, data: ArrayBuffer | Uint8Array) =>
    ipcRenderer.invoke('fs:write-binary', path, data),
  savePastedImage: (mdFilePath: string | null, data: ArrayBuffer, ext: string) =>
    ipcRenderer.invoke('fs:save-pasted-image', mdFilePath, data, ext),
  downloadImage: (mdFilePath: string | null, url: string) =>
    ipcRenderer.invoke('fs:download-image', mdFilePath, url),
  readDir: (path: string) => ipcRenderer.invoke('fs:read-dir', path),
  listMdRecursive: (opts: { rootDir: string; maxDepth?: number }) =>
    ipcRenderer.invoke('fs:list-md-recursive', opts),
  // 从拖拽的 File 对象拿真实磁盘路径
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // dialogs
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  saveFileDialog: (opts: { defaultPath?: string; extension?: string } = {}) =>
    ipcRenderer.invoke('dialog:save-file', opts),
  // window
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // export
  exportPDF: (opts: { html: string; savePath?: string; defaultName?: string }) =>
    ipcRenderer.invoke('export:pdf', opts),
  exportDocx: (opts: { markdown: string; defaultName?: string }) =>
    ipcRenderer.invoke('export:docx', opts),
  // LLM 排版
  formatTxt: (filePath: string, config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke('llm:format-txt', { filePath, config }),
  // menu events
  onMenu: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, v: boolean) => cb(v);
    ipcRenderer.on('window:maximize-change', listener);
    return () => ipcRenderer.removeListener('window:maximize-change', listener);
  },
  // settings persistence
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:save', patch),
};

try {
  contextBridge.exposeInMainWorld('api', api);
} catch (e) {
  console.error('preload exposeInMainWorld failed', e);
}

export type LaiApi = typeof api;
