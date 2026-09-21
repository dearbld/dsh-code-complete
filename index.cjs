// dsh-code-complete —— DSH 代码补全插件（FIM · agent 自主面）
// ─────────────────────────────────────────────────────────────────────────────
// 定位（2026-09-20）：DSH agent 自主补全面（不做人的参与面）·挂载全局。
// 生态位：与 dsh-lens（诊断）/ code_intel（语义索引）/ str_replace_editor（编辑）互补——
//   本件只做「生成候选」一环；LSP 符号级补全另有 dsh-lsp-actions（互补不重叠）。
// 机制吸收：
//   · WorkBuddy：FIM 前缀80%/后缀20%｜当前文件 ≤200 行窗口｜输入 ≤4000 token/≤10000 字符｜停止词 \n\n 与 "// "
//   · DSH 官方：output.render 必为 function（#16175）｜凭证 resolve 取 .value（#16522）｜可选键条件省键（#16484）
//   · 真调实证（09-20）：DeepSeek beta FIM HTTP 200·684ms（含 shell 启动）——主通道超时按激进值设
// 通道三型：①原生 prompt/suffix（DeepSeek 官方）②模板拼接（百炼 qwen-coder-turbo）③extra_body（SiliconFlow）
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  prefixChars: 8000,          // 前缀字符预算（≈80%）
  suffixChars: 2000,          // 后缀字符预算（≈20%）
  windowLines: 200,           // 当前文件窗口（行·光标上下各半）
  maxTokens: 128,             // 默认补全长度
  maxTokensCap: 512,          // 补全长度上限
  timeoutMs: 8000,            // 备用通道硬超时
  deepseekTimeoutMs: 3000,    // 主通道（实测亚秒级）
  throttleMs: 1200,           // 内置节流（防高频自噬·风险表 #20）
  stopWords: ["\n\n", "// "], // WorkBuddy 吸收
};

// ── 节流器（同 adspower 范式）──────────────────────────────────────────────
function makeThrottle(gapMs) {
  let last = 0;
  return () => {
    const now = Date.now();
    const wait = last + gapMs - now;
    if (wait > 0) return { throttled: true, waitMs: wait };
    last = now;
    return { throttled: false };
  };
}

// ── 上下文裁剪（吸 WorkBuddy 参数：80/20 · ≤200 行窗口 · 字符预算）──────
function trimContext(text, line, column, cfg) {
  const src = String(text == null ? "" : text);
  const lines = src.split("\n");
  const total = lines.length;
  const ln = Math.max(1, Math.min(Number(line) || 1, total));
  const curLine = lines[ln - 1] || "";
  const col = (column === undefined || column === null)
    ? curLine.length
    : Math.max(0, Math.min(Number(column) || 0, curLine.length));

  const half = Math.floor((cfg.windowLines - 1) / 2);
  const startLine = Math.max(1, ln - half);
  const endLine = Math.min(total, ln + half);
  const before = lines.slice(startLine - 1, ln - 1);
  const after = lines.slice(ln, endLine);

  let prefix = (startLine > 1 ? "…\n" : "") + before.join("\n") + (before.length ? "\n" : "") + curLine.slice(0, col);
  let suffix = curLine.slice(col) + (after.length ? "\n" + after.join("\n") : "") + (endLine < total ? "\n…" : "");

  const cutPrefix = prefix.length > cfg.prefixChars;
  const cutSuffix = suffix.length > cfg.suffixChars;
  if (cutPrefix) prefix = prefix.slice(prefix.length - cfg.prefixChars); // 保留贴近光标的尾部
  if (cutSuffix) suffix = suffix.slice(0, cfg.suffixChars);              // 保留贴近光标的头部

  return {
    prefix,
    suffix,
    truncated: (startLine > 1) || (endLine < total) || cutPrefix || cutSuffix,
  };
}

// ── 凭证取值（🔴 resolve 返回 ResolvedCredential {value,source}·必取 .value —— #16522）──
async function resolveKey(ctx, ref) {
  try {
    const c = await ctx.credentials.resolve(ref);
    if (!c) return "";
    if (typeof c === "object" && "value" in c) return String(c.value || "");
    return String(c || "");
  } catch {
    return "";
  }
}

// ── 通道三型 ──────────────────────────────────────────────────────────────
function buildChannel(channel, prefix, suffix, maxTokens, cfg) {
  // 型① 原生 prompt/suffix —— DeepSeek 官方 FIM（/beta）
  if (channel === "deepseek") {
    return {
      ref: "DEEPSEEK_API_KEY",
      model: "deepseek-flash",
      timeoutMs: cfg.deepseekTimeoutMs,
      url: "https://api.deepseek.com/beta/completions",
      auth: (k) => ({ Authorization: "Bearer " + k }),
      body: { model: "deepseek-flash", prompt: prefix, suffix, max_tokens: maxTokens, stop: cfg.stopWords },
      pick: (j) => (j && j.choices && j.choices[0] && typeof j.choices[0].text === "string") ? j.choices[0].text : "",
    };
  }
  // 型③ 模板拼接 —— 阿里云百炼 qwen-coder-turbo（FIM 三标记）
  //   ref 支持候选数组：专用 key 优先，通用名兜底（一 REF 一用途·不挪用他用途 key）
  if (channel === "dashscope") {
    return {
      ref: String(cfg.dashscopeRef || "").trim()
        ? String(cfg.dashscopeRef).split(",").map((s) => s.trim()).filter(Boolean)
        : ["CODE_COMPLETE_BAILIAN_KEY", "DASHSCOPE_API_KEY"],
      model: "qwen-coder-turbo",
      timeoutMs: cfg.timeoutMs,
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1/completions",
      auth: (k) => ({ Authorization: "Bearer " + k }),
      body: {
        model: "qwen-coder-turbo",
        prompt: "<|fim_prefix|>" + prefix + "<|fim_suffix|>" + suffix + "<|fim_middle|>",
        max_tokens: maxTokens,
      },
      pick: (j) => (j && j.choices && j.choices[0] && typeof j.choices[0].text === "string") ? j.choices[0].text : "",
    };
  }
  // 型② extra_body —— SiliconFlow（prefix/suffix 参数挂 chat 端点）
  if (channel === "siliconflow") {
    return {
      ref: "SILICONFLOW_API_KEY",
      model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      timeoutMs: cfg.timeoutMs,
      url: "https://api.siliconflow.cn/v1/chat/completions",
      auth: (k) => ({ Authorization: "Bearer " + k }),
      body: {
        model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        messages: [{ role: "user", content: "Complete the code at the cursor." }],
        extra_body: { prefix, suffix },
        max_tokens: maxTokens,
      },
      pick: (j) => (j && j.choices && j.choices[0] && j.choices[0].message && typeof j.choices[0].message.content === "string") ? j.choices[0].message.content : "",
    };
  }
  return null;
}

// ── 单通道调用 ────────────────────────────────────────────────────────────
async function callChannel(ctx, spec) {
  const t0 = Date.now();
  const refs = Array.isArray(spec.ref) ? spec.ref : [spec.ref];
  let key = "", usedRef = "";
  for (const r of refs) {
    const k = await resolveKey(ctx, r);
    if (k) { key = k; usedRef = r; break; }
  }
  if (!key) {
    return { ok: false, channel: spec.model, latencyMs: Date.now() - t0, completion: "", error: "凭证未配置：" + refs.join(" / ") };
  }
  try {
    const res = await fetch(spec.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spec.auth(key) },
      body: JSON.stringify(spec.body),
      signal: AbortSignal.timeout(spec.timeoutMs),
    });
    const raw = await res.text();
    let j = null;
    try { j = JSON.parse(raw); } catch { /* 非 JSON 响应按原文报错 */ }
    const completion = spec.pick(j);
    return {
      ok: res.ok && typeof completion === "string" && completion.length > 0,
      channel: spec.model,
      latencyMs: Date.now() - t0,
      completion: typeof completion === "string" ? completion : "",
      error: res.ok ? "" : String(raw).slice(0, 300),
    };
  } catch (e) {
    return { ok: false, channel: spec.model, latencyMs: Date.now() - t0, completion: "", error: String((e && e.message) || e).slice(0, 300) };
  }
}

// ── 插件主体 ─────────────────────────────────────────────────────────────
module.exports = {
  name: "@legion/dsh-code-complete",
  inject: ["tools", "credentials", "fs"],
  apply(ctx, config) {
    const cfg = { ...DEFAULTS, ...(config || {}) };
    if (!Array.isArray(cfg.stopWords)) cfg.stopWords = DEFAULTS.stopWords;
    const th = makeThrottle(cfg.throttleMs);

    // output.render 必为 function（DSH 装载契约·#16175）
    const gRender = (_a, v) => [{
      type: "text",
      text: (v && v.ok)
        ? ("补全（" + (v.channel || "?") + " · " + v.latencyMs + "ms）：\n" + (v.completion || "(空)"))
        : ("⚠ " + ((v && v.error) ? v.error : "补全失败")),
    }];
    const reg = (t) => ctx.tools.register({
      ...t,
      output: { ...(t.output || {}), render: (t.output && t.output.render) ? t.output.render : gRender },
    });

    reg({
      name: "code_complete",
      description:
        "代码补全（FIM·模型生成式）：读目标文件指定位点上下文 → 裁剪（前缀80%/后缀20%·≤200行窗口·≤10000字符）→ 调线上 FIM 模型 → 返回补全候选。" +
        "与 LSP 符号补全互补——本工具产出「模型生成」的候选。内置节流。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目标文件绝对路径" },
          line: { type: "number", description: "补全位点行号（1-based）" },
          column: { type: "number", description: "列号（0-based·缺省=该行行尾）" },
          maxTokens: { type: "number", description: "补全长度（默认 128·上限 512）" },
          channel: { type: "string", description: "通道：auto（默认，主→备降级）| deepseek | dashscope | siliconflow" },
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            ok: { type: "boolean" },
            completion: { type: "string" },
            channel: { type: "string" },
            latencyMs: { type: "number" },
            truncated: { type: "boolean" },
            error: { type: "string" },
          },
          required: ["ok"],
        },
      },
      execute: async (args) => {
        const t = th();
        if (t.throttled) {
          return { ok: false, completion: "", channel: "", latencyMs: 0, truncated: false, error: "THROTTLED 等待 " + t.waitMs + "ms（内置节流·防高频）" };
        }
        const a = args || {};
        try {
          const target = await ctx.fs.resolve(String(a.path || ""));
          const text = await ctx.fs.readText(target);
          const mt = Math.min(Number(a.maxTokens) || cfg.maxTokens, cfg.maxTokensCap);
          const trim = trimContext(text, a.line, a.column, cfg);
          const want = String(a.channel || "auto");
          const order = (want === "auto") ? ["deepseek", "dashscope", "siliconflow"] : [want];
          let lastErr = "";
          for (const ch of order) {
            const spec = buildChannel(ch, trim.prefix, trim.suffix, mt, cfg);
            if (!spec) { lastErr = "未知通道：" + ch; continue; }
            const r = await callChannel(ctx, spec);
            if (r.ok) {
              return { ok: true, completion: r.completion, channel: r.channel, latencyMs: r.latencyMs, truncated: trim.truncated, error: "" };
            }
            lastErr = r.error || (spec.model + "：空补全");
          }
          return { ok: false, completion: "", channel: "", latencyMs: 0, truncated: trim.truncated, error: lastErr || "全部通道失败" };
        } catch (e) {
          return { ok: false, completion: "", channel: "", latencyMs: 0, truncated: false, error: String((e && e.message) || e).slice(0, 300) };
        }
      },
    });
  },
};
