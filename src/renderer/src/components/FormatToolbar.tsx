/**
 * FormatToolbar — MD 语法提示工具栏
 *
 * 设计原则：
 * 1. 纯展示 + 调用父组件传下来的 editor ref，不持有任何编辑器状态
 * 2. 不改 Editor 内部逻辑；只通过 EditorHandle 暴露的 wrapSelection / linePrefix / insertBlock 三个方法与编辑器交互
 * 3. 样式走 .format-toolbar-* 前缀，不污染 .toolbar / .tb-btn
 * 4. 按钮带 tooltip 显示对应语法模板，方便记不住的人对照抄
 *
 * Popover 实现注意：
 * - 下拉用 React Portal 渲染到 document.body 下面（用 position: fixed 定位）
 * - 原因：父级 .format-toolbar 有 overflow-y: hidden（横向滚动需要），
 *   否则 position:absolute 下拉的 popover 会被工具栏裁剪掉，看不见
 */
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Strikethrough, Code, Code2,
  Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
  Quote, List, ListOrdered, ListChecks, Minus,
  Link, Image as ImageIcon, Table2, Hash, Pilcrow, Sigma,
} from 'lucide-react';
import type { EditorHandle } from './Editor';

// 按钮基础类型
type BaseBtn = {
  id: string;
  title: string;          // tooltip 大标题
  syntax?: string;        // tooltip 副标题（语法示例）
  shortcut?: string;      // tooltip 副标题（快捷键）
  icon: React.ReactNode;
  action: (ed: EditorHandle) => void;
};

// 包裹类：选中文本就包裹，没选就插入占位并选中
const wrapBtns: BaseBtn[] = [
  {
    id: 'bold', title: '粗体', syntax: '**粗体**', shortcut: 'Ctrl+B',
    icon: <Bold size={14} />,
    action: (ed) => ed.wrapSelection('**', '**', '粗体文字'),
  },
  {
    id: 'italic', title: '斜体', syntax: '*斜体*', shortcut: 'Ctrl+I',
    icon: <Italic size={14} />,
    action: (ed) => ed.wrapSelection('*', '*', '斜体文字'),
  },
  {
    id: 'strike', title: '删除线', syntax: '~~删除~~',
    icon: <Strikethrough size={14} />,
    action: (ed) => ed.wrapSelection('~~', '~~', '删除文字'),
  },
  {
    id: 'inline-code', title: '行内代码', syntax: '`code`', shortcut: 'Ctrl+`',
    icon: <Code size={14} />,
    action: (ed) => ed.wrapSelection('`', '`', 'code'),
  },
  {
    id: 'link', title: '链接', syntax: '[文字](https://)', shortcut: 'Ctrl+K',
    icon: <Link size={14} />,
    action: (ed) => ed.wrapSelection('[', '](https://)', '链接文字'),
  },
];

// 行首前缀类：标题/引用/列表/任务
const prefixBtns: BaseBtn[] = [
  { id: 'h1', title: '一级标题', syntax: '# 标题', icon: <Heading1 size={14} />,
    action: (ed) => ed.linePrefix('# ') },
  { id: 'h2', title: '二级标题', syntax: '## 标题', icon: <Heading2 size={14} />,
    action: (ed) => ed.linePrefix('## ') },
  { id: 'h3', title: '三级标题', syntax: '### 标题', icon: <Heading3 size={14} />,
    action: (ed) => ed.linePrefix('### ') },
  { id: 'h4', title: '四级标题', syntax: '#### 标题', icon: <Heading4 size={14} />,
    action: (ed) => ed.linePrefix('#### ') },
  { id: 'h5', title: '五级标题', syntax: '##### 标题', icon: <Heading5 size={14} />,
    action: (ed) => ed.linePrefix('##### ') },
  { id: 'h6', title: '六级标题', syntax: '###### 标题', icon: <Heading6 size={14} />,
    action: (ed) => ed.linePrefix('###### ') },
  { id: 'quote', title: '引用', syntax: '> 引用', icon: <Quote size={14} />,
    action: (ed) => ed.linePrefix('> ') },
  { id: 'ul', title: '无序列表', syntax: '- 列表', icon: <List size={14} />,
    action: (ed) => ed.linePrefix('- ') },
  { id: 'ol', title: '有序列表', syntax: '1. 列表', icon: <ListOrdered size={14} />,
    action: (ed) => ed.linePrefix('1. ') },
  { id: 'task', title: '任务列表', syntax: '- [ ] 待办', icon: <ListChecks size={14} />,
    action: (ed) => ed.linePrefix('- [ ] ') },
];

// 块级模板类：代码块/表格/图片/分隔线
type BlockBtn = BaseBtn & {
  template: string;
  cursor: number;
  selectEnd?: number;
};
const blockBtns: BlockBtn[] = [
  {
    id: 'code-block', title: '代码块', syntax: '```\ncode\n```',
    icon: <Code2 size={14} />,
    template: '```\n在这里写代码\n```',
    cursor: 4,                  // 在 ``` 之后换行后
    selectEnd: 4 + 4,           // 选中"在这里写代码"
    action: (ed) => ed.insertBlock('```\n在这里写代码\n```', 4, 8),
  },
  {
    id: 'image', title: '图片', syntax: '![描述](https://)',
    icon: <ImageIcon size={14} />,
    template: '![图片描述](https://)',
    cursor: 2,                  // 在 ![ 之后
    selectEnd: 6,               // 选中"图片描述"
    action: (ed) => ed.insertBlock('![图片描述](https://)', 2, 6),
  },
  {
    id: 'table', title: '表格', syntax: '| 列1 | 列2 |\n| --- | --- |',
    icon: <Table2 size={14} />,
    template: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
    cursor: 2,                  // 第一个 | 之后
    selectEnd: 4,               // 选中"列1"
    action: (ed) => ed.insertBlock(
      '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
      2, 4,
    ),
  },
  {
    id: 'hr', title: '分隔线', syntax: '---',
    icon: <Minus size={14} />,
    template: '\n---\n',
    cursor: 5,                  // 末尾
    action: (ed) => ed.insertBlock('\n---\n', 5),
  },
];

// 数学公式：KaTeX 已通过 markdown.ts 渲染（$..$ 行内 / $$..$$ 块级）
// 每个按钮插入对应 LaTeX 模板，action 调用 insertBlock 定位光标到第一个占位符
type MathBtn = {
  id: string;
  title: string;     // 中文标题
  symbol: string;    // 视觉符号（unicode 数学符号）
  syntax: string;    // tooltip 显示的语法模板
  template: string;  // 实际插入的内容（不含 $ 包裹）
  cursor: number;    // 光标绝对偏移（在 template 内）
  selectEnd?: number;// 选区结束偏移（可选）
};
const mathBtns: MathBtn[] = [
  {
    id: 'frac', title: '分数', symbol: '½', syntax: '\\frac{a}{b}',
    template: '\\frac{a}{b}',
    cursor: 6, selectEnd: 7,  // 选中第一个 a
  },
  {
    id: 'supsub', title: '上下标', symbol: 'xⁿ', syntax: 'x^{n}  /  x_{i}',
    template: 'x^{n}',
    cursor: 2, selectEnd: 5,  // 选中 n
  },
  {
    id: 'sum', title: '求和 (西格玛)', symbol: '∑', syntax: '\\sum_{i=1}^{n} x_i',
    template: '\\sum_{i=1}^{n} x_i',
    cursor: 4, selectEnd: 5,  // 选中 i
  },
  {
    id: 'prod', title: '累乘', symbol: '∏', syntax: '\\prod_{i=1}^{n} x_i',
    template: '\\prod_{i=1}^{n} x_i',
    cursor: 5, selectEnd: 6,  // 选中 i
  },
  {
    id: 'int', title: '积分', symbol: '∫', syntax: '\\int_{a}^{b} f(x)\\,dx',
    template: '\\int_{a}^{b} f(x)\\,dx',
    cursor: 5, selectEnd: 6,  // 选中 a
  },
  {
    id: 'deriv', title: '一阶导数', symbol: '∂', syntax: '\\frac{dy}{dx}',
    template: '\\frac{dy}{dx}',
    cursor: 6, selectEnd: 7,  // 选中 y
  },
  {
    id: 'deriv2', title: '二阶导数', symbol: '∂²', syntax: '\\frac{d^{2}y}{dx^{2}}',
    template: '\\frac{d^{2}y}{dx^{2}}',
    cursor: 8, selectEnd: 9,  // 选中第一个 2（指数位）
  },
  {
    id: 'lim', title: '极限', symbol: 'lim', syntax: '\\lim_{x \\to \\infty} f(x)',
    template: '\\lim_{x \\to \\infty} f(x)',
    cursor: 5, selectEnd: 6,  // 选中 x
  },
  {
    id: 'sqrt', title: '根号', symbol: '√', syntax: '\\sqrt[n]{x}',
    template: '\\sqrt[n]{x}',
    cursor: 6, selectEnd: 7,  // 选中 n
  },
  {
    id: 'matrix', title: '矩阵', symbol: '⊞', syntax: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    template: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    cursor: 14, selectEnd: 15,  // 选中第一个 a
  },
];

type Props = {
  editorRef: React.RefObject<EditorHandle | null>;
};

/**
 * 计算下拉的 fixed 坐标 + 跟随窗口 resize/scroll 重定位
 * 返回 {top, left}（视口坐标）和一个容器 ref（让下拉能跟随滚动）
 */
function usePopoverPosition(
  anchorRef: React.RefObject<HTMLElement>,
  isOpen: boolean,
  popoverWidth: number,
) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const update = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 优先往下放；视口下沿不够则往上翻
    const POPOVER_MAX_H = 360;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= 120 || spaceBelow >= POPOVER_MAX_H
      ? r.bottom + 4
      : Math.max(8, r.top - POPOVER_MAX_H - 4);
    // 左边对齐按钮左边，但保证不超出视口右边
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popoverWidth - 8));
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    update();
    const onResize = () => update();
    const onScroll = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);  // capture: 捕获所有祖先滚动
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return pos;
}

export const FormatToolbar: React.FC<Props> = ({ editorRef }) => {
  const [headingOpen, setHeadingOpen] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const mathRef = useRef<HTMLDivElement>(null);

  // heading/math popover 的 fixed 坐标（视口坐标，portal 到 body）
  const headingPos = usePopoverPosition(headingRef, headingOpen, 240);
  const mathPos = usePopoverPosition(mathRef, mathOpen, 300);

  // 点击外部关闭标题下拉
  useEffect(() => {
    if (!headingOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      // 忽略 popover 自身的点击（popover 是 portal 到 body 下的，不在 headingRef 内）
      if ((t as HTMLElement).closest?.('.ft-popover')) return;
      if (headingRef.current && !headingRef.current.contains(t)) {
        setHeadingOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [headingOpen]);

  // 点击外部关闭数学下拉
  useEffect(() => {
    if (!mathOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if ((t as HTMLElement).closest?.('.ft-popover')) return;
      if (mathRef.current && !mathRef.current.contains(t)) {
        setMathOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [mathOpen]);

  const run = (action: (ed: EditorHandle) => void) => {
    const ed = editorRef.current;
    if (!ed) return;
    // 先 focus 编辑器，否则 wrapSelection 的 selection 取的是按钮上的位置
    ed.focus();
    // 微任务后执行 action（focus 完成后再 dispatch）
    Promise.resolve().then(() => action(ed));
  };

  // 渲染 heading popover 的内容（按钮们）
  const renderHeadingItems = () => (
    <>
      {prefixBtns.filter((b) => b.id.startsWith('h')).map((b) => (
        <button
          key={b.id}
          className="ft-popover-item"
          title={b.syntax}
          onClick={() => { setHeadingOpen(false); run(b.action); }}
        >
          {b.icon}
          <span>{b.title}</span>
          <code className="ft-popover-syntax">{b.syntax}</code>
        </button>
      ))}
    </>
  );

  return (
    <div className="format-toolbar" onMouseDown={(e) => e.preventDefault() /* 防止点按钮抢光标 */}>
      {/* 组 1：标题（下拉） */}
      <div className="ft-group" ref={headingRef}>
        <button
          className="ft-btn ft-btn-dropdown"
          title="标题（点击展开 H1-H6）"
          onClick={() => setHeadingOpen((o) => !o)}
        >
          <Heading1 size={14} />
          <span className="ft-caret">▾</span>
        </button>
      </div>
      {/* heading popover 渲染到 body 下面，避开工具栏 overflow 裁剪 */}
      {headingOpen && headingPos && createPortal(
        <div
          className="ft-popover ft-popover-portal"
          style={{ top: headingPos.top, left: headingPos.left }}
          // 在 popover 内允许 mousedown，否则会被外层 toolbar 的 onMouseDown 拦掉焦点（其实 portal 后不在 toolbar 里，这里只是保险）
          onMouseDown={(e) => e.stopPropagation()}
        >
          {renderHeadingItems()}
        </div>,
        document.body,
      )}

      <span className="ft-sep" />

      {/* 组 2：粗体/斜体/删除线/行内代码/链接 */}
      <div className="ft-group">
        {wrapBtns.map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}${b.syntax ? `  ·  ${b.syntax}` : ''}${b.shortcut ? `  ·  ${b.shortcut}` : ''}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 3：引用/列表/任务 */}
      <div className="ft-group">
        {[
          prefixBtns.find((b) => b.id === 'quote')!,
          prefixBtns.find((b) => b.id === 'ul')!,
          prefixBtns.find((b) => b.id === 'ol')!,
          prefixBtns.find((b) => b.id === 'task')!,
        ].map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}  ·  ${b.syntax}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 4：代码块/图片/表格/分隔线 */}
      <div className="ft-group">
        {blockBtns.map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}  ·  ${b.syntax}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 5：数学公式（下拉，KaTeX 语法） */}
      <div className="ft-group" ref={mathRef}>
        <button
          className="ft-btn ft-btn-dropdown"
          title="数学公式（点击展开 KaTeX 模板）"
          onClick={() => setMathOpen((o) => !o)}
        >
          <Sigma size={14} />
          <span className="ft-caret">▾</span>
        </button>
      </div>
      {/* math popover 渲染到 body 下面，避开工具栏 overflow 裁剪 */}
      {mathOpen && mathPos && createPortal(
        <div
          className="ft-popover ft-popover-math ft-popover-portal"
          style={{ top: mathPos.top, left: mathPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="ft-popover-item"
            title="行内公式（用 $ 包裹选中文字）"
            onClick={() => {
              setMathOpen(false);
              const ed = editorRef.current;
              if (!ed) return;
              ed.focus();
              Promise.resolve().then(() => ed.wrapSelection('$', '$', 'f(x)'));
            }}
          >
            <span className="ft-math-symbol">$x$</span>
            <span>行内公式</span>
            <code className="ft-popover-syntax">$f(x)$</code>
          </button>
          <button
            className="ft-popover-item"
            title="块级公式（用 $$ 包裹选中文字，独立成行）"
            onClick={() => {
              setMathOpen(false);
              const ed = editorRef.current;
              if (!ed) return;
              ed.focus();
              Promise.resolve().then(() => ed.insertBlock('\n$$\n公式内容\n$$\n', 5, 9));
            }}
          >
            <span className="ft-math-symbol">$$x$$</span>
            <span>块级公式</span>
            <code className="ft-popover-syntax">$$\n...\n$$</code>
          </button>
          <div className="ft-popover-sep" />
          {mathBtns.map((b) => (
            <button
              key={b.id}
              className="ft-popover-item"
              title={b.syntax}
              onClick={() => {
                setMathOpen(false);
                const ed = editorRef.current;
                if (!ed) return;
                ed.focus();
                Promise.resolve().then(() => ed.insertBlock(b.template, b.cursor, b.selectEnd));
              }}
            >
              <span className="ft-math-symbol">{b.symbol}</span>
              <span>{b.title}</span>
              <code className="ft-popover-syntax">{b.syntax}</code>
            </button>
          ))}
        </div>,
        document.body,
      )}

      <span className="ft-sep" />

      {/* 组 6：提示 */}
      <div className="ft-hint">
        <Hash size={11} />
        <span>选中文字再点按钮可包裹</span>
      </div>
    </div>
  );
};
