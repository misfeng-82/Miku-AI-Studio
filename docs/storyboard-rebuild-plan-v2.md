# 分镜版块重建方案 v2（导入剧本 → 拆分剧本 → 生成分镜提示词）

> 状态：**待确认，未动代码**　｜　2026-10-19
> v1 → v2 补了什么：多了 4 个视频模型的提示词差异、行业分镜表字段口径、被删引擎的 18 门清单与数据结构、
> 完整 JSON 契约、三套提示词渲染器、成本估算表、测试矩阵与回滚方案。
> v1 存档：`docs/storyboard-rebuild-plan.md`

---

## 0. 一句话结论

**拆分不花模型钱**（剧本已有场结构，规则切镜可复现），**钱只花在写提示词上**（逐集调用 + 18 条确定性门 + 字段级重修）。
骨架用自家 `f876907^` 的旧实现，格式吸收 Seedance2 的「C/S/P 编号 + 时间轴」，校验吸收 Weaver 的「报错到字段再回灌」，
提示词方法论直接用本地 `seedance-storyboard` 技能。**不引入任何 Python 服务或编排框架。**

---

## 1. 调研（扩展版）

### 1.1 开源项目

| 项目 | 许可 | 做法 | 可复用 | 结论 |
|---|---|---|---|---|
| [Seedance2-Storyboard-Generator](https://github.com/liangdabiao/Seedance2-Storyboard-Generator) | **非 OSI**（仅限学习参考） | Skill + Markdown：四幕剧本 → C/S/P 编号素材 → Seedance 时间轴分镜 | **格式与编号规范**（不可拷文件） | 借鉴 |
| [PenShot / story-shot-agent](https://github.com/neopen/story-shot-agent) | MIT | Python + LangGraph + LlamaIndex + Chroma + Redis，多智能体拆镜 | `fragment` 数据结构、连续性守护思路 | **不集成**（框架与体量冲突） |
| [AI Storyboard Weaver](https://github.com/1AyaNabil1/Ai-storyboard-Weaver) | MIT | pydantic schema → 校验 → **字段级报错回灌**重修 → MD/JSON | **校验-重修模式**（同构复刻，不搬代码） | 借鉴 |
| [shubh-vedi/ai-storyboard-generator](https://github.com/shubh-vedi/ai-storyboard-generator) | 未标注 | 剧本 → 直接出图片帧 | 无 | 不适用（我们只出提示词） |
| [Scene2Storyboard](https://github.com/taylorashley30/Scene2Storyboard) | MIT | 视频 → 分镜（OCR/Whisper/BLIP） | 无 | 不适用（方向相反） |

### 1.2 四个视频模型的提示词偏好（决定「渲染器」要不要做成可插拔）

| 维度 | 即梦 Seedance 2.0 | 可灵 Kling 2.x | Vidu 2.0 | MiniMax H3 |
|---|---|---|---|---|
| 单段时长 | 10–12s（部分 15s） | 5–10s | 4 / 8s | 15s |
| 参考图 | `@图片1` 绑定角色 | 首帧图为主 | **参考图锁定最强**，支持首尾帧 + 运动幅度 | 参考 + 原生音频 |
| 提示词结构 | 中文自然语言 + 时间轴分段 | **10–25 词**，只描述「变化」 | 主体 + 动作 + 幅度 + 运镜 + 场景氛围 | **三字段**：综合多模态描述 / 整体音景 / 非叙事音乐 |
| 负向提示 | **不吃负向**，要正向描述 | 支持 `--no` | 不支持 | 官方结构里没有负向位 |
| 硬限制 | 约 1500 字上限；9 图 / 3 视频参考 | 长动作易崩；多人互动易失败 | 一条一个主动作 | 台词要保留原语言 |
| 对我们的含义 | 主格式 | 需要「短句渲染器」 | 需要「运动幅度」字段 | 需要「三字段渲染器」 |

> 结论：**内部只维护一套 `shot` 模型，导出时按目标模型渲染**。首期只实现 Seedance 渲染器，Kling / H3 留接口不实现。

### 1.3 行业分镜表口径（决定门禁阈值）

| 口径 | 数值 | 来源 |
|---|---|---|
| 60 秒成片镜数 | 15–25 镜，均 3–4s | [AI 视频工作流指南](https://domer.io/blog/ai-video-workflow-guide-script-to-final-cut-6e777346) |
| 60 秒镜数（另一派） | 8–12 镜（更少镜头、更长镜） | [AI 漫剧全流程](https://blog.csdn.net/weixin_29090089/article/details/166277361) |
| 短剧细拆口径 | 150–180s 拆 35+ 原子镜，单镜 2–5s | [AI 短剧第三课](https://i.yeyulingfeng.com/a/460917.html) |
| 单镜时长铁律 | 2–6s；远景 4–6s，特写 2–3s | [AI 友好型分镜表](https://ima.qq.com/wiki/) |
| 分镜表必备字段 | 镜号 / 景别 / 机位运镜 / 画面 / 台词旁白 / 时长 / 音效 / 备注 | 同上四篇一致 |

**我们取中间值**：默认单镜 **2–6s**，整集镜数 = `round(集秒数 / 3.5)`，允许 ±30%；特写超 3s、远景短于 3s 报警告不拦。

### 1.4 本地已有资产

| 资产 | 位置 | 用法 |
|---|---|---|
| Seedance 分镜技能 | `~/.workbuddy/skills/seedance-storyboard/`（`seedance_prompt_guide.md`、`storyboard_schema.md`） | 提示词公式、anchor 规则、Motion 清单、字段定义**直接落地** |
| 旧分镜实现 | git `f876907^`：`storyboardService.js`、`engine/storyboard.mjs`（18 门）、前端 `viewBoard` | 恢复骨架；门禁与自检清单已验证过 |
| 剧本契约 | `parseScriptText.js` / `scriptSpec.js` | 「导入」这一段已具备（文本 + JSON + 格式提示） |
| 资产层 | `assetService.js` | 产出 C/S/P 编号与一致性提示词，分镜直接引用 |
| 结构层 | `genreLibrary` / `storyStructure` | 知道这一集是起势还是决战，节奏不用猜 |

### 1.5 旧实现的 18 道门（`engine/storyboard.mjs` 原文 id）

`coverage`（节拍恰好认领一次）、`segCap`（段长 ≤15s）、`cutLen`（单镜时长）、`fit`（段内镜头适配）、`duration`（整集时长）、`crowd`（多人同框拆解）、`id`（段号纪律）、`size`（景别受控）、`camera`（运镜受控）、`frame`（画面字段齐全）、`names`（正文禁人名）、`refs`（场景/人物/道具对账）、`h3s/h3d/h3e`（H3 三字段结构与切点）、`recipe`（配方漂移）、`comp`（构图六字段）、`sd`（Seedance 约束）。

> 这次的处理：**18 条全部保留**；把旧的 `sd`（一揽子约束）拆成 `negative` / `motion` / `quality` 三条便于定位；
> 再新增 `shotCount`（行业镜数口径）、`promptLen`（长度上限）、`oneAction`（一镜一主动作）→ 合计 **22 条**（见 §7）。

---

## 2. 产品定位与边界

**与已删功能的区别**（为什么不是"回滚"）：

| | 旧「分镜拆解」 | 新「分镜版块」 |
|---|---|---|
| 拆分 | 模型一次吐整集分镜（贵、不可复现） | **确定性规则切镜**，模型只负责难切的场 |
| 提示词 | 一次生成 H3 + Seedance 两套 | 先一条主提示词，按目标模型渲染导出 |
| 粒度 | 只能整集跑 | 可只拆一集、只重写一镜 |
| 校验 | 18 门 | 22 门（+行业时长/镜数口径） |
| 入口 | 「分镜资产」独立域 | 「剧本创作」域，紧跟导入与生成 |

**只做提示词文本，不做图、不做视频**；不做拖拽时间轴（P2 再说）。

---

## 3. 用户流程

```
① 导入 / 选剧本（复用现有载入卡，支持项目）
        ↓
② 拆分：选集 → 自动切镜 → 表格可改（合并/拆分/改时长）
        ↓
③ 生成提示词：选风格 + 画幅 + 目标模型 → 试跑 1 集 → 看到门禁结果
        ↓
④ 全部生成（按集排队，断点续跑）→ 复制单镜/单集/全集 → 导出 MD/CSV/JSON → 存项目
```

状态机：`idle → splitting → split-ready → prompting → partial → done`，任何一步失败都停在原地并保留已完成的集。

---

## 4. 数据契约

```jsonc
// 拆分结果（确定性，可离线、可 diff）
{
  "source": "《妈妈偏爱找》",
  "episodes": [{
    "ep": 1,
    "targetSeconds": 75,
    "scenes": [{
      "sceneId": "S01",
      "name": "幼儿园·亲子手作展厅",
      "lighting": "日景",
      "shots": [{
        "id": "E01-S01-01",          // 集-场-镜，全局唯一
        "sec": 3.5,
        "beat": "冲突",               // 钩子/铺垫/冲突/反转/高潮/结局
        "size": "medium",            // 受控词表
        "move": "slow push-in",      // 受控词表，单值
        "visual": "周茂把手工作品扔进垃圾桶",
        "line": "这东西也配摆进沈家的活动？",
        "speaker": "C03",            // 角色编号，不是人名
        "cast": ["C03", "C01"],
        "props": ["P02"],
        "transitionIn": "cut"        // cut / dissolve / none
      }]
    }]
  }],
  "stats": { "episodes": 1, "scenes": 2, "shots": 9, "seconds": 31.5 }
}
```

```jsonc
// 提示词结果（模型产出，逐镜）
{
  "ep": 1,
  "styleId": "cn-comic",
  "aspect": "9:16",
  "shots": [{
    "id": "E01-S01-01",
    "prompt": "周茂，深灰西装、寸头、左手腕银色手表 [anchor]，把一件手工作品扔进垃圾桶 [动作]。Motion: arm swings down, fingers release, paper crumples。幼儿园展厅，白天 [场景]。Medium shot, slow push-in [镜头]。顶光偏冷，背景虚化 [光线]。国漫赛璐璐，线条硬朗 [风格]。4K，面部清晰，结构正常，画面稳定无闪烁 [质量]。",
    "anchor": "周茂，深灰西装、寸头、左手腕银色手表",
    "motion": ["arm swings down", "fingers release", "paper crumples"],
    "refs": { "C": ["C03"], "S": ["S01"], "P": ["P02"] },
    "render": { "seedance": "...", "kling": null, "h3": null }
  }],
  "gates": [{ "id": "size", "label": "景别受控", "ok": true, "detail": "" }],
  "passed": true,
  "llm": { "mode": "runtime", "model": "gpt-5.6-..." }
}
```

**唯一 ID 规则**：`E{集}-S{场}-{镜}`，场与镜都补零；重拆只换镜号，不换集号，保证导出可追溯。

---

## 5. 模块拆分

```
前端
  public/views/storyboard.js      三段式页面（导入态 / 拆分表 / 提示词表）
  public/views/assets.js          复用：C/S/P 编号来源
  public/app.js                   SIDEBAR 新增「分镜脚本」；PAGES、runners 注册

后端
  src/services/splitService.js    剧本 → 集/场/镜（确定性 + 可选模型重切）
  src/services/promptBoardService.js  镜 → 提示词（模型 + 门禁 + 重修 + 缓存）
  src/engine/shots.mjs            受控词表、22 门、时长引擎、渲染器（seedance/kling/h3）
  src/assets/shotSpec.js          提示词公式、anchor 规则、质量约束串、示例
  src/routes/api.js               4 个新路由
  src/repo/projectRepo.js         STAGES 增加 'storyboard'
  src/agent/mockData.js           shots 样本（结构真、内容假）
  src/services/shotExport.js      MD / CSV / JSON 导出（从旧 exportCutPack 精简）

依赖方向：views → api → services → engine/assets（engine 不 import services，保证可单测）
```

---

## 6. 关键算法

### 6.1 确定性切镜（不调模型）

输入是 `script.episodes[].scenes[].flow[]`（动作 / 台词 / 字幕标记）。规则按顺序执行：

1. **一拍一镜**：每个 `action` 或 `line` 先各自成镜（台词镜默认 2.2s，动作镜 2.5s）。
2. **合并**：相邻两镜同场景、同人物、总时长 ≤6s，且中间没有转场标记 → 合成一镜（视觉描述并列）。
3. **切分**：单镜 >6s 或台词 >22 字 → 按标点与动作边界切，保证每段有独立主动作。
4. **字幕归位**：`【钩子字幕】【黑屏】` 不进镜内容，挂到集尾字段。
5. **场覆盖校验**：每场至少 1 镜；空场补一个「环境建立镜」（固定机位、4s）。
6. **集时长校准**：整集估算秒数偏离目标 ±30% 时，优先压缩氛围镜、拉长冲突镜，而不是均匀缩放。

> 结果纯函数：同一输入两次切镜完全一致（selftest 会做幂等断言）。

### 6.2 anchor phrase（一致性的根）

- 从资产层取角色固定描述：`姓名 + 服装主色 + 发型 + 标志性配饰`，**一次生成、逐镜逐字复用**。
- 存进 `outline.characters[].anchor`，分镜只引用，不重写。
- 门禁逐字比对：同一 `C` 编号在所有镜里的 anchor 必须字符串相等。

### 6.3 Motion 清单

- 从镜头的 `visual` + `move` 推导，固定 2–4 个微动作，小幅度优先（`breathes gently` > `jumps`）。
- 禁止与运镜冲突（`orbit` + `static` 同时出现 = 门禁挂）。

### 6.4 提示词三套渲染

| 渲染器 | 结构 | 状态 |
|---|---|---|
| `seedance` | `主体 + 动作 + Motion: … + 场景 + 景别 + 运镜 + 光线 + 风格 + 质量约束` | **首期实现** |
| `kling` | 压到 10–25 词：`主体 + 主动作 + 一句运镜`，去掉 Motion 清单 | 留接口，P1 |
| `h3` | 三字段：综合多模态描述 / 整体音景 / 非叙事音乐 | 留接口，P2 |

---

## 7. 门禁（22 条）

| # | id | 判据 | 来源 |
|---|---|---|---|
| 1 | `coverage` | 每集每个节拍恰好被 1 镜认领，顺序不乱 | 旧 |
| 2 | `segCap` | 段（同场景连续镜）≤15s | 旧 |
| 3 | `cutLen` | 单镜 2–6s（特写 ≤3s 告警） | 旧 + 行业 |
| 4 | `shotCount` | 每集镜数 = `round(秒/3.5)` ±30% | **新增** |
| 5 | `epDuration` | 整集 55–95s，±15% | 旧 `duration` |
| 6 | `fit` | 动作幅度与时长相容（3s 不做完整转身） | 旧 |
| 7 | `crowd` | 3 人以上同框必须有拆解方案 | 旧 |
| 8 | `id` | 镜号 `E01-S01-01` 连号、格式合法 | 旧 |
| 9 | `size` | 景别 ∈ 受控 6 值 | 旧 |
| 10 | `camera` | 运镜 ∈ 受控 10 值，**单值** | 旧 |
| 11 | `frame` | 每镜必须有 visual，且 ≥8 字 | 旧 |
| 12 | `names` | 提示词正文不得出现中文人名 | 旧 |
| 13 | `refs` | C/S/P 编号都必须存在于资产表 | 旧 |
| 14 | `anchor` | 同角色 anchor 逐字一致 | 旧（强化） |
| 15 | `negative` | 出现 `no / without / 不要 / 避免` = 挂 | 旧 `sd` 拆出 |
| 16 | `motion` | Motion 清单 2–4 条，全部为可见动作 | 旧 |
| 17 | `quality` | 必含质量四件套（4K / 面部清晰 / 无变形 / 无闪烁） | 旧 |
| 18 | `promptLen` | 40–300 字（Seedance 1500 字上限内） | **新增** |
| 19 | `oneAction` | 一镜只一个主动作（动词数 >3 告警） | **新增** |
| 20 | `lineOnce` | 每句台词恰好出现 1 次，不丢不重 | 旧 `coverage` 细化 |
| 21 | `recipe` | 与风格配方卡不漂移（可选挂载） | 旧 |
| 22 | `comp` | 构图六字段（焦距/机位/构图/视线/焦点/稳定） | 旧 |

**失败处理**：把 `镜号 + 字段 + 具体错误`（如 `E01-S01-03.camera: 出现两种运镜 orbit+static`）回灌重写一轮；
仍不过 → 标红保留，用户在页面上手改，**不阻断其他镜**。

---

## 8. 接口契约

| 方法 | 路径 | 入参 | 出参 | 备注 |
|---|---|---|---|---|
| POST | `/api/shots/split` | `{script, outline, ep?}` | `{episodes[], stats}` | 纯确定性，无 LLM |
| POST | `/api/shots/prompts` | `{script, outline, episode, styleId, aspect, model}` | `{shots[], gates[], passed, llm}` | 逐集，可单集重跑 |
| POST | `/api/shots/export` | `{shots, format: md\|csv\|json, model}` | `{format, text, total}` | 不重跑生成 |
| GET | `/api/projects/:id/storyboard` | — | `{board}` | 读回上次结果 |

错误码沿用现有：`400` 参数、`422` 剧本不完整、`502` 模型侧失败（带可读原因）。

---

## 9. 前端交互

**三段式单页**（`storyboard`）：

1. 顶部状态条：剧本名 / 集数 / 已拆镜数 / 已生成镜数 / 目标模型 / 预计调用次数。
2. 第②段「拆分」：左侧集列表，右侧镜表（镜号、时长、景别、运镜、画面、台词）；行内可改、可合并/拆分；「重拆这一场」。
3. 第③段「提示词」：卡片式逐镜展示（提示词正文 + 复制 + 重写这一镜），顶部门禁徽章（`22/22` 或 `18/22`），失败项可展开看原因。
4. 底部：`试跑第 1 集` / `生成全部` / 导出三格式 / 存进项目。

空态、加载态（显示已等待秒数，沿用 `busyBtn`）、失败态（门禁红条 + 原因）、部分成功（按集标记）都要有。

---

## 10. 成本模型

| 项 | 估算 |
|---|---|
| 拆分 | **0 次调用**（确定性） |
| 提示词 · 每集 | 1 次 + 重修 0–1 次（约 3.5k 输入 / 2k 输出 token） |
| 60 集全量 | 60–120 次调用，约 21 万–42 万输入 token |
| 试跑 1 集 | 1–2 次调用 |
| 缓存键 | `hash(该集文本 + styleId + anchor + model)`，命中直接返回 |

页面上先给「预计 N 次调用」，用户确认后才跑全量。

---

## 11. 实施计划（P0–P5）

| 阶段 | 交付 | 验收命令/标准 | 估时 |
|---|---|---|---|
| **P0 契约与骨架** | `engine/shots.mjs`（词表 + 22 门）、`shotSpec.js`、mock 样本 | `selftest` 新增门禁用例全绿 | 0.5d |
| **P1 拆分** | `splitService` + `/api/shots/split` | 同一剧本两次结果字节一致；台词不丢不重；每场有镜 | 0.5d |
| **P2 提示词** | `promptBoardService` + 渲染器 + 重修 | mock 下 1 集 22/22；假模型塞坏值能被门挡住并重写 | 1d |
| **P3 前端** | 三段式页面 + 复制/导出 | 无 Key 可走完整链路；单镜重写只重跑一镜 | 1d |
| **P4 集成** | 项目阶段、缓存、断点续跑、用量统计 | 关掉页面再回来能续跑；用量里能看到 shots | 0.5d |
| **P5 收尾** | README/docs/冒烟/回归 | `selftest` + `smoke` 全过 | 0.5d |

每阶段结束给一次「改了什么 / 验证输出 / 截图」，不一次性推完。

---

## 12. 测试计划

| 层 | 用例 |
|---|---|
| 单元 | 切镜幂等、时长校准、anchor 生成、三套渲染器快照、22 门逐条（每条一正一反） |
| 集成 | `/split → /prompts → /export` 串联；项目存取；缓存命中不重复调用 |
| 假模型 | 本地起 OpenAI 兼容假服务，返回坏 JSON / 坏字段，验证重修与降级（沿用上次的 `/tmp/fake-llm.mjs` 套路） |
| 回归 | `selftest`（现有 82 项 + 新增）+ `smoke`（mock 实例） |
| 手工 | 真实剧本跑 1 集，检查提示词可读性与一致性 |

---

## 13. 风险矩阵

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| Seedance2 许可证 | 高（若抄文件） | 合规 | 只借结构与格式，文字自写，文档标注来源 |
| 模型输出格式花 | 中 | 高 | schema + 22 门 + 字段级重修；坏值保留可手改 |
| 一致性漂移（同一人两副面孔） | 中 | 高 | anchor 逐字复用 + 门禁比对 + 编号引用 |
| 成本超预期 | 中 | 中 | 默认试跑 1 集、按集缓存、页面预估调用数 |
| 超长剧本爆上下文 | 中 | 中 | 逐集调用；只带本集 + 前后集摘要 |
| 前端卡顿 | 中 | 中 | 按集折叠、默认渲染当前集 |
| 与「评估/优化」定位重叠 | 低 | 低 | 明确分工：评估看整稿、优化改整稿、分镜只做镜头层 |
| 又删又加引起困惑 | 中 | 低 | README 写清「重建」与旧功能差异；入口放在剧本创作域 |

**回滚**：所有新增文件独立（`shots.mjs` / `splitService` / `promptBoardService` / `storyboard.js`），
路由与入口各 4 行；出问题 `git revert` 单个提交即可，不影响评估/优化/资产三条已有链路。

---

## 14. 交付物

1. 可用的「分镜脚本」页（导入 → 拆分 → 提示词 → 导出/存项目）
2. `docs/storyboard.md`：字段说明、门禁清单、提示词公式、三模型差异
3. `selftest` 新增 ≥20 项、`smoke` 新增 4 项
4. mock 样本一套（无 Key 可演示）

---

## 15. 待确认（带推荐默认）

| # | 问题 | 推荐 |
|---|---|---|
| 1 | 方案 | **A：恢复自家实现 + 重构**（B 照 Seedance2 重写 / C 接 PenShot 服务） |
| 2 | 首期范围 | **MVP**：拆分 + Seedance 提示词 + MD/CSV/JSON 导出；时间轴与尾帧放 P1 |
| 3 | 目标模型 | **Seedance 2.0 优先**，Kling/H3 留渲染器接口 |
| 4 | 入口位置 | **剧本创作域**，排在「AI 剧本生成」「格式转换」之后 |
| 5 | 试跑策略 | **默认只跑第 1 集**，确认后「生成全部」 |
| 6 | 门禁严格度 | **22 门全开**；特写超 3s 只告警不拦 |

回复「按推荐来」即按上表默认值开工；有异议改哪条说哪条。
