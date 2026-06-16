import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './styles/codemirror.css';
import './styles/preview.css';
// KaTeX css inlined to avoid CSP/CDN dependency
import 'katex/dist/katex.min.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
