import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useSettingsStore } from './stores/settings';
import './styles/global.css';
import './styles/codemirror.css';
import './styles/preview.css';
// KaTeX css inlined to avoid CSP/CDN dependency
import 'katex/dist/katex.min.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

// 启动后异步加载持久化设置；加载完 App 内会自动 re-render
void useSettingsStore.getState().loadFromDisk();
