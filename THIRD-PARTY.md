提高产率（productivity）和交付节奏（cadence），「躺下来陪你聊代码」不上线。

## 许可分区

| 范围 | 许可证 |
| --- | --- |
| 本项目原创代码（src/services、src/routes、public、scripts 等） | **MIT** |
| src/engine/outline.mjs、src/engine/script.mjs、scripts/fixtures/渡口-*.json | **Apache-2.0** |

后者基于 [`eternityspring/shuohao-skills`](https://github.com/eternityspring/shuohao-skills)（Copyright 2026 烁皓）修改，已按 Apache-2.0 要求保留许可与署名。

## 设计来源

- **工程**：`ai-short-drama-studio`（Studio One）的确定性 mock 流水线思路、`omni-workbench` 的 token 纪律
- **剧本生成方法论**：`honolulu0/llm-script-factory`（MIT，六阶段流水线裁成三段 + 短剧常识/卡点规则/精修师原则）、`zenstory-ai/drama-skills`（MIT，可拍摄性原则）；产出格式契约是《都市涅槃》标准稿（`src/assets/scriptSpec.js`）
- **分镜引擎**：`eternityspring/shuohao-skills`（Apache-2.0，分镜 15 秒段 + 子镜头结构 + 12 道门）
- **风格预设与角色分层**：`style-presets`（MIT，中文/英文/反向三件套）

## 明确不引入

| 项目 | 原因 |
| --- | --- |
| LangChain / LangGraph / AutoGen / CrewAI / Dify | 编排框架——手写循环是本项目核心价值；引入后抽象层变厚、可测试性下降 |
| ArcReel / inkos | AGPL 传染，不能 MIT 混合分发 |
| 模型 API 转发/缓存中间件 | 增加运维负担，且项目定位是单机工具 |

以上清单仅供开发决策参考，不构成法律建议。