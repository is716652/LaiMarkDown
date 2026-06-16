import React from 'react';
import { useEditorStore } from '../stores/editor';
import { X, FileText } from 'lucide-react';

export const TabBar: React.FC = () => {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const newTab = useEditorStore((s) => s.newTab);

  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActive(t.id)}
        >
          <FileText size={13} className="tab-icon" />
          <span className="tab-title">
            {t.title}
            {t.dirty && <span className="dot">●</span>}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="tab-new" title="新建" onClick={() => newTab()}>+</button>
    </div>
  );
};
