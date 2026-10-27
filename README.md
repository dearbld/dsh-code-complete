# dsh-code-complete · DSH 代码补全（FIM）

DeepSeek Harness 插件：给 agent 挂一个 **FIM（fill-in-the-middle）代码补全工具** `code_complete`——读目标文件指定位上下文 → 调线上 FIM 模型 → 返回补全候选。与 LSP 符号补全互补（本件是**模型生成**候选）。

## 特性

- **多通道自动降级**：DeepSeek 官方 FIM（原生 prompt/suffix）→ DashScope qwen-coder-turbo（模板拼接）→ SiliconFlow（extra_body）；主→备链路自动切换，`channel` 参数可指定。
- **窗口裁剪**：FIM 前缀 80% / 后缀 20%·≤200 行窗口·输入 ≤10000 字符（长文件自动截取有效上下文）。
- **零运行时依赖**：纯 Node 标准库 + 原生 fetch。
- **内置节流**＋凭证走 DSH CredentialProvider（`ctx.credentials.resolve`）。

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-code-complete
```

手动挂载（host 组合 cordis.patch.yml insert 行）亦可——插件注册工具 `code_complete(path, line, column?, maxTokens?, channel?)`。

## 配置

`apply(ctx, config)` 第二参（可选）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `prefixChars` / `suffixChars` | 8000 / 2000 | 光标前后上下文的字符预算 |
| `windowLines` | 200 | 当前文件上下文窗口行数 |
| `maxTokens` | 128 | 默认补全长度 |
| `maxTokensCap` | 512 | 补全长度上限 |
| `timeoutMs` | 8000 | DashScope / SiliconFlow 请求超时 |
| `deepseekTimeoutMs` | 3000 | DeepSeek 官方 FIM 请求超时 |
| `throttleMs` | 1200 | 两次调用之间的最小间隔 |
| `stopWords` | `["\n\n", "// "]` | 停止词数组；非数组时回落默认值 |
| `dashscopeRef` | 内置两个 REF | 可用逗号分隔的 REF 列表覆盖 DashScope 凭证查找顺序 |

降级链由工具参数的 `channel` 选择：`auto`（默认）依次尝试 `deepseek → dashscope → siliconflow`；也可指定其中一个通道。没有 `maxTokensDefault` 或 `channelOrder` 配置键。

## 凭证

按通道解析 REF：DeepSeek 官方使用 `DEEPSEEK_API_KEY`；DashScope 依次尝试 `CODE_COMPLETE_BAILIAN_KEY`、`DASHSCOPE_API_KEY`，也可由 `dashscopeRef` 覆盖；SiliconFlow 使用 `SILICONFLOW_API_KEY`。凭证均可通过 DSH CredentialProvider 管理，插件读取解析结果中的 `.value`。

## License

MIT
