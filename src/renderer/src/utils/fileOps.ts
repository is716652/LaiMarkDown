/**
 * 文件操作：open / save
 * 主进程通过 IPC 暴露 fs:* 和 dialog:* 接口
 */
import { useEditorStore } from '../stores/editor';

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
  useEditorStore.getState().openFile(target, res.content);
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
