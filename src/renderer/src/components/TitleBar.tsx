import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-drag" />
      <div className="title-bar-text">来MarkDown</div>
      <div className="title-bar-controls">
        <button className="title-btn" onClick={() => window.api.windowMinimize()} title="最小化">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="title-btn" onClick={() => window.api.windowToggleMaximize()} title="最大化">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="title-btn close" onClick={() => window.api.windowClose()} title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
};
