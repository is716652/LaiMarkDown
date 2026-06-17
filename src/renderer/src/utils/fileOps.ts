/**
 * 文件操作：open / save
 * 主进程通过 IPC 暴露 fs:* 和 dialog:* 接口
 */
import { useEditorStore } from '../stores/editor';

// 流式打开阈值：> 1MB 的文件分块插入 editor
const STREAM_THRESHOLD = 1024 * 1024;
const STREAM_CHUNK = 256 * 1024; // 每块 256KB

export async function openFile(filePath?: string): Promise<void> {
  let target: string | undefined = filePath;
  if (!target) {
    const r = await window.api.openFileDialog();
    if (r.canceled || !r.filePaths?.length) return;
    target = r.filePaths[0];
  }
  if (!target) return;
  const res = await window.api.readFile(target);
  if (!res.ok) {
    alert('打开失败：' + res.error);
    return;
  }

  const content = res.content;
  const sizeBytes = new Blob([content]).size;

  // 大文件流式打开
  if (sizeBytes > STREAM_THRESHOLD) {
    void openLargeFileStream(target, content);
    return;
  }

  useEditorStore.getState().openFile(target, content);
}

/**
 * 大文件流式打开：
 * 1. 建一个空 tab（占位 + 让 editor 挂载）
 * 2. 状态栏显示加载进度
 * 3. 分批 view.appendChunk，每批间 await 0 让主线程喘气
 * 4. 完成后同步 doc 全文到 store
 */
async function openLargeFileStream(filePath: string, content: string): Promise<void> {
  const totalBytes = new Blob([content]).size;
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  // 用 openFile 建空 tab
  const id = useEditorStore.getState().openFile(filePath, '');
  useEditorStore.getState().setLargeFileLoad({
    fileName,
    percent: 0,
    totalBytes,
    loadedBytes: 0,
  });

  // 等 editor 挂载完成（下一帧）
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  // 找当前 active editor 的 view（通过 EditorHandle 暴露的 clearDoc / appendChunk）
  // 我们的 Editor 在 App.tsx 用 ref 暴露了 handle，但要 fileOps 拿到不容易。
  // 改用：暴露一个全局的"当前 editor handle"机制
  const handle = (window as any).__currentEditorHandle;
  if (!handle) {
    // 兜底：直接塞全文（与小于阈值相同的行为）
    useEditorStore.getState().setLargeFileLoad(null);
    useEditorStore.setState((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: false } : t)),
    }));
    return;
  }

  handle.clearDoc();
  let loaded = 0;
  for (let i = 0; i < content.length; i += STREAM_CHUNK) {
    const chunk = content.slice(i, i + STREAM_CHUNK);
    handle.appendChunk(chunk);
    loaded += chunk.length;
    const percent = Math.min(100, Math.round((loaded / totalBytes) * 100));
    useEditorStore.getState().setLargeFileLoad({
      fileName,
      percent,
      totalBytes,
      loadedBytes: loaded,
    });
    // 让主线程喘气（每批让出一次宏任务）
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  // 完成后同步全文到 store
  useEditorStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: false } : t)),
  }));
  useEditorStore.getState().setLargeFileLoad(null);
}

export async function saveActiveFile(): Promise<void> {
  const tab = useEditorStore.getState().activeTab();
  if (!tab) return;
  if (!tab.filePath) return saveAsActiveFile();
  const res = await window.api.writeFile(tab.filePath, tab.content);
  if (!res.ok) {
    alert('保存失败：' + res.error);
    return;
  }
  useEditorStore.getState().markSaved(tab.id);
}

export async function saveAsActiveFile(): Promise<void> {
  const tab = useEditorStore.getState().activeTab();
  if (!tab) return;
  const r = await window.api.saveFileDialog({ defaultPath: tab.title, extension: 'md' });
  if (r.canceled || !r.filePath) return;
  const res = await window.api.writeFile(r.filePath, tab.content);
  if (!res.ok) {
    alert('保存失败：' + res.error);
    return;
  }
  const title = r.filePath.split(/[\\/]/).pop() || tab.title;
  useEditorStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, filePath: r.filePath, title, dirty: false } : t)),
  }));
}

export async function openFolder(): Promise<void> {
  const r = await window.api.openFolderDialog();
  if (r.canceled || !r.filePaths?.length) return;
  const { useSidebarStore } = await import('../stores/sidebar');
  await useSidebarStore.getState().openFolder(r.filePaths[0]);
}
