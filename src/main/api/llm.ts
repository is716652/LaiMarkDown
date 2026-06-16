/**
 * LLM 客户端（DeepSeek 兼容 OpenAI 协议）
 *
 * 关键设计：
 * - 用 Node 18+ 内置 fetch，不引第三方包
 * - 仅在 main 进程跑，API Key 永不进 renderer
 * - 非流式：一次拿全内容，简单可靠
 * - 失败/超时/超长都给清晰错误
 */

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;     // 默认 https://api.deepseek.com
  model: string;       // 默认 deepseek-chat
  timeoutMs?: number;  // 默认 60000
};

export type LlmResult =
  | { ok: true; content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { ok: false; error: string };

// 系统提示词：通用 txt → md 排版
const SYSTEM_PROMPT = `你是一个 Markdown 排版助手。用户会给你一段纯文本（TXT）内容，可能来自：
- 课堂笔记 / 会议纪要 / 流水账 / 简历 / 学生作业 / 邮件正文 / 任何无格式文本

你的任务：把这段文本重新组织成**结构清晰、视觉美观**的 Markdown。

**排版要求**：
1. 识别并使用合适的标题层级（# / ## / ###），不要把所有内容都做成 H1
2. 列表、并列项用有序/无序列表（-/1.）
3. 时间、人物、金额、地址等关键信息用**粗体**或表格突出
4. 对话、问答用引用块（>）
5. 关键结论、TL;DR 放在文首或 H2 章节
6. 段落之间用空行隔开，不要一坨
7. 如果原文明显有结构（比如"第一章"、"1.1"），用对应标题层级保留
8. **不要**添加原文中没有的内容；不要解释你做了什么；只输出排版后的 Markdown
9. 中文内容用半角标点 + 数字/英文间留一个空格（中文排版规范）
10. 代码、命令、文件名用 \`code\` 或 \`\`\`code block\`\`\`

**输出**：只输出 Markdown 文本本身，不要任何前后说明、注释、\`\`\`markdown 围栏\`\`\` 包装。`;

/**
 * 调 LLM 把 txt 排版成 md
 */
export async function formatTxtWithLlm(
  cfg: LlmConfig,
  txtContent: string
): Promise<LlmResult> {
  if (!cfg.apiKey) {
    return { ok: false, error: '未配置 API Key，请在设置里填写' };
  }
  if (!cfg.baseUrl) {
    return { ok: false, error: '未配置 Base URL' };
  }
  if (!cfg.model) {
    return { ok: false, error: '未配置 Model' };
  }
  if (!txtContent || !txtContent.trim()) {
    return { ok: false, error: 'txt 内容为空' };
  }

  // 简单限长：超过 ~80K 字符（约 20-30 万 token）就拒绝，避免发出去被截断
  if (txtContent.length > 80000) {
    return {
      ok: false,
      error: `txt 过长（${txtContent.length} 字符），超过 80K 限制。请自行分段后再试。`,
    };
  }

  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: txtContent },
    ],
    stream: false,
    temperature: 0.3,  // 排版要稳定，不要太发散
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return {
        ok: false,
        error: `HTTP ${resp.status}: ${errText.slice(0, 500)}`,
      };
    }

    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { ok: false, error: 'API 响应无 content 字段' };
    }

    // 清理：有时模型会包 ```markdown ... ``` 围栏，去掉
    let cleaned = content.trim();
    if (cleaned.startsWith('```markdown')) {
      cleaned = cleaned.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const usage = data?.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined;

    return { ok: true, content: cleaned, usage };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, error: '请求超时（默认 60s）' };
    }
    return { ok: false, error: (e as Error).message || String(e) };
  } finally {
    clearTimeout(timeout);
  }
}
