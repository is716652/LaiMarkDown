# 来MarkDown 2.0

现代化的 Markdown 桌面编辑器。沿用 1.0 验证过的技术栈，重写架构，重点修 1.0 的性能痛点。

## 技术栈

- **Electron 32** + **Vite 5** + **React 18** + **TypeScript 5**
- **CodeMirror 6** — 编辑器（Compartment 模式动态配置）
- **marked** — Markdown 解析
- **Prism** — 代码高亮（**Web Worker 异步**，不阻塞主线程）
- **KaTeX** — 数学公式
- **Mermaid** — 流程图（懒加载）
- **Zustand** — 状态管理
- **lucide-react** — 图标

## 1.0 → 2.0 主要改进

| 问题 | 1.0 | 2.0 |
|------|-----|-----|
| 预览卡顿 | 无防抖，每打一个字符全量重渲染 | **150ms 防抖** |
| Prism 阻塞主线程 | 同步高亮 | **Web Worker 异步** |
| Mermaid 阻塞 | 每次内容变都同步重渲染 | **IntersectionObserver 懒加载** |
| tabSize 改设置不生效 | 初始化时只跑一次 | **Compartment 动态 reconfigure** |
| vendor 打包一团 | 全部塞 1 个 2MB chunk | **vendor-codemirror / vendor-markdown / vendor-react 拆分** |
| 滚动同步偏移 | 按 scrollTop 比例 | 行级 anchor（v2.1 计划） |
| 慢文档打开卡 | readFileSync 一次性加载 | 流式（v2.1 计划） |

## 快速开始

### 启动开发模式

```bat
双击 start-dev.bat
```

或命令行：

```bash
pnpm install
pnpm run dev
```

开发模式下 Vite 起在 5173，Electron 自动加载 dev URL，DevTools 自动打开。

### 打包 Windows 安装包

```bat
双击 build-installer.bat
```

或：

```bash
pnpm run package
```

安装包在 `release/` 目录。

## 项目结构

```
src/
├── main/         # Electron 主进程
├── preload/      # preload（IPC 桥接）
└── renderer/     # React 渲染层
    └── src/
        ├── components/   # UI 组件
        ├── stores/       # Zustand stores
        ├── utils/        # 工具函数
        └── styles/       # 样式
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开文件夹 |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+F` | 查找 |
| `Ctrl+H` | 替换 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+Alt+S` | 互换编辑/预览位置 |
| `Ctrl+/` | 切换预览 |
| `Mod-/` | （编辑器内）切换预览 |

## 已知限制（v2.0 计划）

- 大文件（>5MB）打开仍卡（计划 v2.1 流式）
- 导出 PDF/HTML/DOCX 暂未实现
- 协作/云同步暂未支持

## AI 排版（v2.0+）

把通用 txt 拖进窗口任意位置，应用会调用大模型自动把无格式文本排版成结构清晰的 Markdown，并在新 tab 里打开排版结果。

### 使用步骤

1. 点击工具栏右侧的 **✨ AI** 按钮
2. 在弹出菜单里填：
   - **API Key**：你的大模型 Key
   - **Base URL**：默认 `https://api.deepseek.com`，自建服务可改
   - **Model**：下拉选 `deepseek-v4-flash`（推荐：快+便宜）或 `deepseek-v4-pro`（最强）
3. 关闭菜单
4. **拖一个 `.txt` 文件**到窗口任意位置 → 状态栏出现"✨ AI 排版中：xxx.txt..." → 完成后自动新建 tab，标题是 `原文件名 (AI 排版)`

### 支持的模型

- `deepseek-v4-flash` — 推荐默认，速度快、价格低，适合排版任务
- `deepseek-v4-pro` — 最强，复杂文档用

> 旧版 `deepseek-chat` / `deepseek-reasoner` 将于 2026/07/24 弃用。

### 实现细节

- **API Key 存本地设置**（Zustand + electron-store），仅 main 进程使用，永不进 renderer
- **DeepSeek 兼容 OpenAI 协议**（`POST /v1/chat/completions`），Node 18+ 内置 fetch 调用
- **温度 0.3**（排版稳定不跑偏）
- **超时 60s**（AbortController）
- **80K 字符硬上限**（超长 txt 拒绝，提示用户分段）
- **拖拽用 `webUtils.getPathForFile`** 拿真实文件路径（Electron 32 标准）
- **排版完成后**新建 tab + 标题加 `(AI 排版)` + dirty=true（让用户 Ctrl+S 选保存位置）

### 限制

- **仅支持 `.txt` 文件**（其他后缀会提示"只支持 .txt"）
- **要求 txt 是 UTF-8 编码**（GBK 会提示用户先转码）
- **txt > 80K 字符**会被拒绝，提示用户分段

### 自定义 Base URL

如果用自建服务或中转 API，把 Base URL 改成对应地址即可，Model 字段填该服务支持的模型名。

## License

MIT
