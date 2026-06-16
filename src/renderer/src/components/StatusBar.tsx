import React from 'react';
import { useEditorStore } from '../stores/editor';
import { useAiStore } from '../stores/ai';

export const StatusBar: React.FC = () => {
  const tab = useEditorStore((s) => s.activeTab());
  const viewMode = useEditorStore((s) => s.viewMode);
  const splitSwap = useEditorStore((s) => s.splitSwap);
  const aiFormatting = useAiStore((s) => s.formatting);
  const aiError = useAiStore((s) => s.error);

  const lines = tab ? tab.content.split('\n').length : 0;
  const chars = tab ? tab.content.length : 0;
  const words = tab ? tab.content.trim().split(/\s+/).filter(Boolean).length : 0;

  // AI 排版中 / 错误 提示优先显示
  if (aiFormatting) {
    return (
      <div className="status-bar">
        <span className="sb-item sb-ai">✨ AI 排版中：{aiFormatting.fileName}...</span>
        <span className="sb-spacer" />
        <span className="sb-item">{viewMode}{splitSwap ? ' (已互换)' : ''}</span>
      </div>
    );
  }
  if (aiError) {
    return (
      <div className="status-bar">
        <span className="sb-item sb-error">⚠ {aiError}</span>
        <span className="sb-spacer" />
        <span className="sb-item">{viewMode}{splitSwap ? ' (已互换)' : ''}</span>
      </div>
    );
  }

  return (
    <div className="status-bar">
      <span className="sb-item">{tab?.filePath || '未保存'}</span>
      <span className="sb-item">{tab?.dirty ? '● 未保存' : '✓ 已保存'}</span>
      <span className="sb-spacer" />
      <span className="sb-item">{lines} 行</span>
      <span className="sb-item">{words} 词</span>
      <span className="sb-item">{chars} 字符</span>
      <span className="sb-item">{viewMode}{splitSwap ? ' (已互换)' : ''}</span>
    </div>
  );
};
