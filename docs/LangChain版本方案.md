# LangChain 版方案（先评审，不写代码）

**日期**：2026-10-27
**状态**：方案待确认 · 未落任何代码
**结论摘要**：技术上完全可行，约 **2.5 人日**；但**这个项目的形态不是 LangChain 的最佳场景**。建议做成并行版而非替换主线——理由见第 9、10 节。

---

## 0. 先给三个实测数字（不是估算）

| 项 | 数字 | 怎么来的 |
| --- | --- | --- |
| 最小依赖集 | `@langchain/core` + `@langchain/openai` = **14 个包** | 临时目录 `npm install --package-lock-only` 解析依赖树 |
| 安装体积 | **87 MB**（`@langchain` 14M / `langsmith` 14M / `zod` 7.7M / 其余） | 真实 `npm install` 后 `du -sh node_modules` |
| 现在项目 | **0 依赖 / 0 MB** | `package.json` 的 `dependencies` 为空对象 |

⚠️ **不要装 `langchain` 元包**：它 1.5.20 的依赖里已经含 `@langchain/langgraph` + `langgraph-checkpoint`，体积再翻一倍。本方案只用 `@langchain/core` + `@langchain/openai`。

---

## 1. 目标与非目标

**目标**
- LLM 层改用 LangChain 1.x：结构化输出、LCEL 编排、可切换供应商
- **保持所有 API 契约不变**（42 个端点、请求/响应结构、错误码）
- **24 道确定性质量门一行不动**（那是剧本工程的资产，不是 LLM 代码）

**非目标**
- 不改前端（18 个视图、增量生成逻辑全部复用）
- 不改存储层（JSON 文件）
- 不引入 agent 循环 / 工具调用（本项目没有这个场景，见第 6 节）
- 不动已上线的零依赖主线

---

## 2. 版本与环境基线（已核实，2026-10-27）

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| `@langchain/core` | 1.x（随 openai 包解析） | **所有 `@langchain/*` 必须共用同一个 core 版本**，否则运行期出现难以定位的类型错配 |
| `@langchain/openai` | 1.5.x | 提供 `ChatOpenAI` |
| `zod` | `^3.25.76` 或 `^4` | core 的 peer 范围就是这两个 |
| Node.js | **22+** | v1 迁移指南要求 22；项目当前正是 22 |

**v1 与网上教程的关键差异（踩坑点）**

| 老写法（0.x，网上到处都是） | v1 现状 |
| --- | --- |
| `StructuredOutputParser` from `langchain/output_parsers` | **import 路径已移除**，直接用 `model.withStructuredOutput(zodSchema)` |
| `LLMChain` / `SequentialChain` / `ConversationChain` | 移到 `@langchain/classic` 包，新代码不该用 |
| `AgentExecutor` / `createToolCallingAgent` | 视为 legacy，新写法是 `createAgent()`（LangGraph 支撑） |

> 也就是说：随手抄一篇 2024 年的教程，大概率直接跑不起来。

---

## 3. 架构映射：现在怎么写 → 换成什么

| 层 | 现在（手写 550 行） | LangChain 版 | 判断 |
| --- | --- | --- | --- |
| HTTP 客户端 | `llmClient.js` 320 行：fetch + 超时 + 429/5xx 退避重试 | `new ChatOpenAI({ model, apiKey, timeout, maxRetries, configuration: { baseURL } })` | 收益中等：省 320 行，但可观测性要自己补回调 |
| 输出约束 | prompt 里写 JSON 契约 + `jsonRepair.js` 124 行五级修复 | `model.withStructuredOutput(zodSchema)` | **收益最高**：校验前移到 schema，修复逻辑由框架重试 |
| 三步编排 | 手写 async 顺序 + 显式传参 | `RunnableSequence.from([...])` / `prompt.pipe(model).pipe(parser)` | 收益低：三步固定顺序，pipe 只是换个写法 |
| 离线 mock | `mockData.js` 内置样本 + `USE_MOCK=1` | 自定义 `MockChatModel extends BaseChatModel` | 成本中等：要适配 `_generate` 与结构化输出两条路径 |
| 计量 | 自己记 token/耗时 → `data/llm-usage.json` | `handleLLMEnd` 回调采集，写同一个文件 | 持平：回调里拿 usage 元数据，落盘逻辑不变 |
| 失败语义 | 上游失败返回 `502 UPSTREAM`，**不静默降级** | 需要包一层 catch 把 LangChain 异常映射回同 code | **必须保留**，这是产品级要求 |
| Agent / 工具调用 | 无 | 无 | 用不上，见第 6 节 |

---

## 4. 目录与文件级改造清单

新建 `03_langchain版/`（与 `01_完整工程` 并列，互不影响）：

```
03_langchain版/
├── package.json              ← 新增 3 个依赖 + overrides 锁 core 版本
├── src/
│   ├── engine/               ← 原样复制（24 道门，一行不改）
│   ├── services/             ← 原样复制（业务逻辑，只换调用入口）
│   ├── routes/               ← 原样复制（契约不变）
│   ├── repo/ http/ public/   ← 原样复制
│   └── agent/
│       ├── lc/
│       │   ├── schemas.js        ← zod：Story / Outline / Episode 三个 schema
│       │   ├── chat.js           ← ChatOpenAI 工厂（读 config，兼容自建网关 baseURL）
│       │   ├── chains.js         ← 三条链：storyChain / outlineChain / episodeChain
│       │   ├── mockModel.js      ← MockChatModel（离线、零费用）
│       │   └── usage.js          ← 回调：采集 token/耗时 → llm-usage.json
│       ├── mockData.js       ← 复用（作为 MockChatModel 的数据源）
│       └── llm.js            ← 改为「选 LangChain 还是 mock」的唯一开关
└── README.md                 ← 改造说明 + 与原版对比
```

被替代（不在新版出现，原版 git 历史里仍在）：
- `src/agent/llmClient.js`（320 行）
- `src/agent/jsonRepair.js`（124 行）

---

## 5. 关键骨架（示意，实现时须逐条对照 1.5.x 文档核实签名）

> 本节是给评审看的"长什么样"，不是可直接运行的代码。**标注 `⌛核实` 的部分我没有实跑验证过**。

### 5.1 模型工厂（兼容自建 OpenAI 网关）

```js
import { ChatOpenAI } from '@langchain/openai';
import { config } from '../../config.js';

export function makeChat() {
  return new ChatOpenAI({
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    temperature: 0.85,
    timeout: config.llm.timeoutMs,
    maxRetries: config.llm.maxRetries,
    // ⌛核实：v1 里自建网关的 baseURL 走 configuration 还是顶层参数
    configuration: { baseURL: config.llm.baseUrl },
  });
}
```

### 5.2 结构化输出（替代 jsonRepair）

```js
import { z } from 'zod';

export const EpisodeSchema = z.object({
  ep: z.number().int(),
  scenes: z.array(z.object({
    head: z.string(),            // 场标：场1-2 夜 内 渡口·码头
    lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
  })),
});

// ⌛核实：method 取值（json_schema / functionCall）对自建网关的兼容性
const structured = makeChat().withStructuredOutput(EpisodeSchema, { name: 'episode' });
```

**关键风险**：`withStructuredOutput` 依赖服务商的 `response_format` / function calling。**自建网关不一定支持** → 必须有 fallback：普通 JSON 模式 + zod 校验 + 失败重试 N 次，仍失败则抛 `502 UPSTREAM`（与原版语义一致）。

### 5.3 LCEL 链（替代手写顺序）

```js
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';

const episodePrompt = ChatPromptTemplate.fromMessages([
  ['system', '你是短剧编剧。严格按分集大纲写第 {ep} 集，只输出 schema 要求的字段。'],
  ['human', '大纲：{outline}\n上一集结尾：{prevEnding}'],
]);

// ⌛核实：prompt → model(withStructuredOutput) 的直连写法
const episodeChain = episodePrompt.pipe(episodeModel);
```

### 5.4 离线 MockChatModel（保持零费用可测）

```js
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';

export class MockChatModel extends BaseChatModel {
  _llmType() { return 'mock'; }
  async _generate(messages) {
    const text = mockReplyFor(messages);          // 复用现有 mockData
    return { generations: [{ text, message: new AIMessage(text) }] };
  }
}
```

**关键风险**：`withStructuredOutput` 在 mock 下会走 tool-calling 分支，`MockChatModel` 必须能产出框架认可的结构化载荷，否则 6 套测试全挂。这是整个改造里**最容易卡住的一处**，建议第 1 步就验证它。

### 5.5 计量回调 + 关闭遥测

```js
// 计量：handleLLMEnd 里拿 usage，写回 data/llm-usage.json（与原版同文件同结构）
const usageHandler = {
  handleLLMEnd(output, runId) { /* 记 model / tokens / ms */ },
};
```

⚠️ **隐私**：LangChain 支持 LangSmith 追踪。**必须在 `.env.example` 里显式写 `LANGSMITH_TRACING=false` / `LANGCHAIN_TRACING_V2=false`**，并在 README 注明"提示词与剧本内容不出本机"。默认不开，但不能靠"默认"——要显式关。

---

## 6. 为什么仍然不用 `createAgent()`

v1 的主推是 `createAgent()`（LangGraph 支撑的 agent 循环）。本项目**没有工具可选、没有分支、没有自主决策**：
三步固定顺序，输入输出都是确定 schema。套 agent 的结果是——多一层图编译、多一个状态机、调试路径更长，而行为完全不变。

**LangChain 版的定位是"结构化输出 + 供应商抽象"，不是"agent 化"。** 这个边界要写清楚，否则改造会失控成"为了用框架而用框架"。

---

## 7. 验证方案（复用现有资产）

| 现有检查 | LangChain 版是否需要改 |
| --- | --- |
| `selftest` 87 项 | 纯函数，**不受影响** |
| `uicheck` | 前端未改，**不受影响** |
| `enginecheck` 14+10 门 | 引擎未改，**不受影响** |
| `smoke` 59 项 | 打 API，契约不变 → 应全绿 |
| `featuretest` 113 项 | 同上 |
| `rendercheck` 38 项 | 前端未改 → 应全绿 |

**必须新增的测试**
1. `schema 校验`：故意喂非法输出，确认被 zod 拦住并触发重试
2. `fallback 路径`：模拟网关不支持 response_format → 走 JSON 模式 + 校验重试
3. `mock 模型 + 结构化输出`：确认离线可用（最容易出问题的一处）
4. `错误映射`：上游 401/429/500 → 仍映射为原版错误码，不泄漏堆栈

**对比指标（用于产出对比表）**
LOC（llmClient+jsonRepair vs lc/）、冷启动时间、单集生成耗时、token 消耗、失败率、`node_modules` 体积、调试一次 prompt 问题所需步骤。

---

## 8. 工作量（单人）

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| 1 | 目录骨架 + `MockChatModel` 跑通三段式（最大不确定性，先做） | 0.5 天 |
| 2 | 三条链 + zod schema + 失败 fallback | 1 天 |
| 3 | 计量回调 + 错误映射 + 跑通 6 套 | 0.5 天 |
| 4 | 对比数据 + 对比文档 + 部署说明 | 0.5 天 |
| | **合计** | **2.5 天** |

> 阶段 1 是风险闸口：如果 `MockChatModel` + `withStructuredOutput` 走不通，后面全是白做。**建议先做阶段 1，通过再继续。**

---

## 9. 得到什么 / 失去什么（诚实对照）

**得到**
- 结构化输出工程化：schema 即契约，不用手写 124 行 JSON 修复
- 供应商可切换：换 `ChatAnthropic` / `ChatGoogleGenerativeAI` 只改一行
- 社区与文档生态：面试时"我用了 LangChain 的 LCEL 和 structured output"是对方熟悉的语言
- 一份**实测对比表**——这本身是很强的作品集素材

**失去**
- **零依赖**这个卖点彻底没了（0 → 14 包 / 87MB）
- 部署变重：Render 构建命令要从空改成 `npm install`，冷启动变慢
- 调试链路变长：出问题要穿透到框架内部才能确认 prompt 实际发了什么
- 版本漂移风险：v1 把 legacy 搬进 `@langchain/classic`，下一次大改同样要迁
- 线上站点如果换成这版，"解压即跑、不装依赖"的演示能力消失

---

## 10. 建议（按你的真实目的选）

| 如果你的目的是 | 建议 | 理由 |
| --- | --- | --- |
| **面试时能讲清"为什么不用"** | **不必做** | 现在的论证（3 次固定调用 / 24 门必须手写 / 零依赖约束）已经足够有力，做了反而变成"我也用了" |
| **简历上要有 LangChain 项目经历** | **做并行版（推荐）** | 两份都在手，能给出实测对比表："同功能两条实现，我选零依赖的原因是……"——这比"我用了 LangChain"高一个层级 |
| **想真用它上线** | **不建议** | 收益（省 320 行）与代价（87MB + 部署变更 + 调试成本）不匹配 |
| **想学 LangChain 本身** | 做，但别动主线 | 拿一个并行目录当练手场，主线继续可用 |

**我的判断**：做并行版，产出对比表。这是唯一能同时拿到"会用框架"和"有判断力"两个标签的做法。

---

## 11. 这份方案不能证明什么

- 第 5 节的代码骨架**按官方文档与检索结果编写，未在 `1.5.20` 实跑验证**（标注 `⌛核实` 的签名需在实现时逐个确认）
- 没有验证过自建 OpenAI 兼容网关对 `withStructuredOutput` 的支持情况——这是**最大的未知**
- 2.5 人日是单人估算，不含踩 v1 API 变更坑的时间（如果坑多，可能翻倍）
- "对比表更有说服力"是判断，不是实测结论

---

## 下一步（需要你确认）

1. **要不要做**？（三个选项：不做 / 并行版 / 替换主线）
2. 若做：**先只做阶段 1**（0.5 天，验证 `MockChatModel` + 结构化输出能否离线跑通），通过再继续——这样最坏情况只损失半天
3. 模型调用默认仍走 mock，**接真模型需要你提供 Key 并明确批准**（会产生真实费用）
