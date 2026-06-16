/**
 * Web Worker for Prism highlighting.
 * 把 Prism 跑到 Worker 里，主线程不被阻塞。
 */
import Prism from 'prismjs';
// 语言是按需加载的——主线程把"需要高亮的代码+语言"发过来
// 这里先加载常用语言

// 基础语言
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup-templating';

export type HighlightRequest = {
  id: number;
  lang: string;
  code: string;
};

export type HighlightResponse = {
  id: number;
  html: string;
};

self.addEventListener('message', (e: MessageEvent<HighlightRequest>) => {
  const { id, lang, code } = e.data;
  const grammar = Prism.languages[lang];
  let html: string;
  if (grammar) {
    try {
      html = Prism.highlight(code, grammar, lang);
    } catch {
      html = code.replace(/</g, '&lt;');
    }
  } else {
    html = code.replace(/</g, '&lt;');
  }
  const resp: HighlightResponse = { id, html };
  (self as unknown as Worker).postMessage(resp);
});

export {};
