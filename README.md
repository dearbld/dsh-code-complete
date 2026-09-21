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
| `timeoutMs` | 30000 | 单次 FIM 请求超时 |
| `maxTokensDefault` | 128 | 补全长默认（上限 512） |
| `channelOrder` | auto 次序 | 覆盖默认降级链 |

## 凭证

按通道自动解析（存在哪个走哪个）：DeepSeek 官方 → `DEEPSEEK_API_KEY`；DashScope → `GLM_EMBEDDING_KEY` 之外的百炼系 key；SiliconFlow → 对应渠道 key。均可通过 DSH 凭证库管理。

## License

MIT
