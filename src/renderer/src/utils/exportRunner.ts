/**
 * 导出执行器
 * 把命令面板 / 菜单 / Toolbar 都串起来
 */
import { useEditorStore } from '../stores/editor';
import { exportHTML, exportPDF, saveTextAs } from './exporters';

type ExportKind = 'pdf' | 'html';

export async function runExport(kind: ExportKind): Promise<void> {
  const tab = useEditorStore.getState().activeTab();
  if (!tab) {
    alert('没有可导出的内容');
    return;
  }
  const title = tab.title || 'untitled';

  if (kind === 'html') {
    const r = await exportHTML({ title, markdown: tab.content });
    if (!r.ok) return;
    const ok = await saveTextAs(r.html, r.defaultName, 'html');
    if (ok) console.log('[export] HTML saved:', r.defaultName);
    return;
  }

  if (kind === 'pdf') {
    const r = await exportPDF({ title, markdown: tab.content });
    if (!r.ok) {
      if (!('canceled' in r && r.canceled)) {
        alert('PDF 导出失败：' + (r as { error?: string }).error);
      }
      return;
    }
    console.log('[export] PDF saved as', r.defaultName);
    return;
  }
}
