/**
 * 导出执行器
 * 把命令面板 / 菜单 / Toolbar 都串起来
 */
import { useEditorStore } from '../stores/editor';
import { exportHTML, exportPDF, saveTextAs } from './exporters';

type ExportKind = 'pdf' | 'html' | 'docx';

export async function runExport(kind: ExportKind): Promise<void> {
  const tab = useEditorStore.getState().activeTab();
  if (!tab) {
    alert('没有可导出的内容');
    return;
  }
  const title = tab.title || 'untitled';
  // 文件名清洗：去扩展名 + 去非法字符
  const safeBase = title.replace(/\.(md|markdown|markdown\.txt)$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';

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

  if (kind === 'docx') {
    const r = await window.api.exportDocx({ markdown: tab.content, defaultName: `${safeBase}.docx` });
    if (!r.ok) {
      if (!('canceled' in r && r.canceled)) {
        alert('DOCX 导出失败：' + (r as { error?: string }).error);
      }
      return;
    }
    console.log('[export] DOCX saved as', r.path);
    return;
  }
}
