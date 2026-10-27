# 分镜版块重建方案（导入剧本 → 拆分剧本 → 生成分镜提示词）

> 状态：**待确认，尚未动代码**
> 日期：2026-10-19
> 背景：分镜拆解功能已于 `f876907` 整体下线。这次不是回滚，而是按「导入 → 拆分 → 提示词」三段重新产品化，
> 并把「拆分」单独抽出来，让用户能只拆不生成提示词、只改某一镜、只跑某一集。

---

## 一、GitHub 调研结论

| 项目 | 许可 | 做什么 | 技术栈 | 对我们的可复用度 |
|---|---|---|---|---|
| [liangdabiao/Seedance2-Storyboard-Generator](https://github.com/liangdabiao/Seedance2-Storyboard-Generator) | **非 OSI**（「仅供学习和参考使用」） | 故事 → 四幕剧本 → C/S/P 编号素材 → Seedance 时间轴分镜 | Claude Code Skill + 纯 Markdown | **思路与格式可借鉴，文件不可拷贝**。C/S/P 编号、`0-3秒画面` 时间轴、尾帧描述、视频延长串联、运镜词表都值得照抄结构（不照抄文字） |
| [neopen/story-shot-agent（PenShot）](https://github.com/neopen/story-shot-agent) | MIT | 剧本 → 分镜片段 → Sora/Veo 提示词，带连续性守护 | Python + LangGraph + LlamaIndex + Chroma + Redis | **不可嵌入**（框架与体量和我们的「零依赖、不引编排框架」红线冲突）。可借鉴 `fragment` 数据结构与「连续性守护」思路 |
| [1AyaNabil1/Ai-storyboard-Weaver](https://github.com/1AyaNabil1/Ai-storyboard-Weaver) | MIT | 故事 → 逐场分镜，schema 校验 + 报错回灌重修 | Python CLI + pydantic | **架构最接近**：`JSON schema 校验 → 把字段级错误喂回模型重写 → 最多 N 轮`，与我们生成链路的「门禁 + 诊断重修」同构，可直接在 Node 里复刻这套流程（不搬代码） |
| [shubh-vedi/ai-storyboard-generator](https://github.com/shubh-vedi/ai-storyboard-generator) | 未标注 | 剧本 → 直接出**图片帧**（Gemini 图像） | React + FastAPI | 低。我们只出提示词，不出图 |
| [taylorashley30/Scene2Storyboard](https://github.com/taylorashley30/Scene2Storyboard) | MIT | **视频** → 分镜（反向） | OpenCV + Whisper + BLIP | 无。方向相反 |

### 调研里真正有用的三条

1. **「素材先编号，提示词再引用」是跨镜头一致性的关键**（Seedance2 的做法）。
   角色 `C01`、场景 `S01`、道具 `P01`，分镜提示词里不写「苏清鸢」，写 `@图片1(C01)`。
   我们已有 `assetService`（角色/场景资产提示词）与 `outline.characters[].id`，天然能接。
2. **时间轴式提示词比段落式更适合短视频模型**（Seedance2）。
   `0-3秒：高空俯拍建立场景 / 3-6秒：推近主体 / … / 12-15秒：落版`，比一整段形容词更容易被模型遵守。
3. **校验要能「报错到字段」再回灌**（Weaver）。
   只说「格式不对」模型会瞎猜；说「第 3 个镜头的 duration 超了 15s」它才改得对。

### 本地已有资产（零成本、零许可风险）

| 资产 | 位置 | 能复用成什么 |
|---|---|---|
| Seedance 分镜技能 | `~/.workbuddy/skills/seedance-storyboard/`（Prompt 公式、anchor phrase、Motion 清单、三视图、I2V 首帧、MD/JSON/Excel 输出） | **提示词方法论直接落地**，不用再研究怎么写 |
| 已删除的分镜实现 | git `f876907^`：`storyboardService.js`（18 门 + H3/Seedance 双提示词 + 导出包）、`engine/storyboard.mjs`（受控词表、`seedFromScript`）、前端 `viewBoard` | **骨架可直接恢复**，省掉 60% 工作量；拆开重写比从零快 |
| 剧本契约 | `public/parseScriptText.js` + `src/assets/scriptSpec.js` | 「导入」这一段已经做好，含 JSON 直读与格式校验 |
| 资产层 | `src/services/assetService.js` | 产出 C/S/P 编号与一致性提示词，分镜直接引用 |
| 结构层 | `genreLibrary` / `storyStructure` | 拆镜时知道「这一集是起势还是决战」，节奏不用猜 |

---

## 二、方案选型

| 方案 | 做法 | 工作量 | 风险 | 结论 |
|---|---|---|---|---|
| **A. 恢复自家实现并重构**（推荐） | 从 `f876907^` 取回 `storyboardService` / `engine` / 导出，按新契约改造：拆出「拆分」与「提示词」两步、补 Seedance 时间轴格式、入口挪到剧本创作域 | 中 | 低（代码是自己的，18 门经过实战） | ✅ 采用 |
| B. 照 Seedance2 重写 | 完全按它的 Markdown skill 流程实现 | 中 | **许可**：只可参考不可拷贝；且它是文件流不是服务，要重新设计交互 | 部分借鉴（格式与编号） |
| C. 接 PenShot 微服务 | Docker 起 Python 服务，Node 调 REST | 高 | 引入 LangGraph/Chroma/Redis，违背项目红线；部署复杂度翻倍 | ❌ 不采用 |
| D. 从零自研 | 丢掉历史实现重写 | 高 | 18 门与 Seedance 自检已调过，重写等于重踩坑 | ❌ 不采用 |

**最终路线**：A 为骨架 + Seedance2 的「编号 + 时间轴」格式 + Weaver 的「字段级报错回灌」+ 本地技能的提示词公式。

---

## 三、功能范围

### 本期（MVP，可验收）

1. **导入剧本**：复用现有「载入剧本」（文本 / .json / 粘贴），不新写。
2. **拆分剧本**（新，独立步骤）：
   - 集 → 场 → 镜三级结构，每镜含：镜号、时长、景别、运镜、画面、台词、出场角色、场景
   - **纯确定性**：优先按剧本已有的「场」与动作/台词节拍切；只有「一场太碎或太长」时才调模型重切
   - 支持只拆某一集、重拆某一集、手工合并/拆分相邻镜
3. **生成分镜提示词**（模型）：
   - 每条：`主体(anchor) + Motion 清单 + 场景 + 景别 + 单一运镜 + 光线 + 风格 + 质量约束`
   - 引用 C/S/P 编号（来自资产层），保证跨镜一致
   - 逐集生成、逐集过门，不过门带诊断重修一轮
4. **校验（门禁）**：约 14 条确定性门（见技术方案），全在代码里，不交给模型自觉
5. **产物**：页面上逐镜看 / 单镜复制 / 单集复制 / 导出 MD + CSV + JSON / 存进项目阶段
6. **成本控制**：默认只跑第 1 集（试跑），确认后再批量；按集缓存，改了一集只重跑一集

### 下一期（P1）

- Seedance 时间轴格式（`0-3秒画面`）与 `【声音】【参考】` 段
- 尾帧描述 + 集间「视频延长」衔接链
- 三视图定妆提示词（接资产层）
- 一次导出「整集分镜表」给剪辑
- 单镜重写（手改一句提示词就重生成这一镜）

### 明确不做

- 不出图、不出视频（只出提示词文本）
- 不做镜头级时间轴编辑器（拖拽排序留到 P2）
- 不引入任何 Python 服务或编排框架

---

## 四、模块拆分

```
前端
  public/views/storyboard.js        新页面：导入状态 → 拆分结果 → 提示词 → 导出
  public/views/assets.js            复用：资产库仍在，供 C/S/P 编号引用
  public/app.js                     侧栏 + PAGES + runners 注册（新增 id: storyboard）

后端
  src/services/splitService.js      新：剧本 → 集/场/镜（确定性为主，模型兜底重切）
  src/services/promptBoardService.js 新：镜 → 提示词（模型 + 门禁 + 重修）
  src/engine/shots.mjs              恢复并精简：受控词表（景别 5 值、运镜 8 值）、时长/密度门、自检清单
  src/assets/shotSpec.js            新：提示词公式与硬规则（从 seedance-storyboard 技能提炼）
  src/routes/api.js                 新增 4 个路由（见下）
  src/repo/projectRepo.js           STAGES 增加 'storyboard'（单阶段，不拆两步存）
  src/agent/mockData.js             增加 shots 样本（结构真、内容假），保证无 Key 可跑通

契约
  { episode, scenes[], shots[] }    拆分结果（确定性，可离线）
  { shots[{ id, sec, size, move, prompt, motion[], refs{C,S,P}, line }] }  提示词结果
```

### 接口

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/api/shots/split` | `script, outline, ep?` | `{ episodes[{ ep, scenes[{ shots[] }] }], stats }` |
| POST | `/api/shots/prompts` | `script, outline, shots, ep, styleId, aspect` | `{ shots[], gates[], passed, llm{mode,model} }` |
| POST | `/api/shots/export` | `shots, format(md/csv/json)` | `{ format, text, total }` |
| GET | `/api/projects/:id/storyboard` | — | 项目里存过的那份 |

---

## 五、技术方案

### 1. 拆分：先确定性，后模型

- 输入是已有契约（`script.episodes[].scenes[].flow[]`），**场已经分好了**，不需要模型重新理解剧本
- 规则：每个「动作 + 台词」节拍 → 一个候选镜；连续同景别、同人物的短节拍合并（≥2s）；单镜上限 12s（Seedance），超了按标点与动作边界切
- 只有这三种情况调模型：① 一场超过 4 镜且无标点边界；② 用户点「重拆这一场」；③ 剧本没有场结构（纯文字稿）
- 好处：**拆分不花钱、可复现、失败率接近零**，钱只花在写提示词上

### 2. 提示词：一条公式 + 一份受控词表

```
主体(anchor phrase，逐镜逐字复用) + 动作(显式 Motion: a, b, c) + 场景
+ 景别(extreme wide/wide/medium/close-up/extreme close-up)
+ 单一运镜(push-in/pull-back/pan/orbit/tracking/crane/handheld/static)
+ 光线氛围 + 画风后缀(stylePresets) + 质量与防变形约束
```

- 参考图写成 `@图片1(C01) 角色参考 / @图片2(S01) 场景参考`，不用人名（模型只认编号）
- 风格后缀复用 `stylePromptSuffix(styleId)`，与资产层同一来源
- 一条提示词只描述一个连续时刻；跨场景必须先切镜

### 3. 门禁（14 条，确定性）

| 类别 | 门 | 判据 |
|---|---|---|
| 结构 | 镜数 | 每集 8–40 镜 |
| 结构 | 时长 | 单镜 1–12s，整集 55–95s（±15%） |
| 结构 | 场覆盖 | 剧本里每场至少 1 镜 |
| 结构 | 台词归位 | 每句台词恰好出现在 1 镜，不丢不重 |
| 一致性 | 角色引用 | 每镜至少 1 个 C 编号，且都在资产表内 |
| 一致性 | 场景引用 | 每镜恰好 1 个 S 编号 |
| 一致性 | anchor 复述 | 同一角色跨镜主体措辞完全一致（逐字比对） |
| 一致性 | 词表 | 景别/运镜必须是受控词表里的值 |
| 提示词 | 单一运镜 | 一条里出现两种运镜 = 挂 |
| 提示词 | 禁负向 | 出现 `no / without / 不要` 等负向表述 = 挂（Seedance 不吃负向） |
| 提示词 | 禁角色名 | 正文里出现中文人名 = 挂（应写编号） |
| 提示词 | 质量约束 | 必须含 `4K / 稳定构图 / 无变形` 类约束 |
| 提示词 | 长度 | 40–300 字（过长模型不遵守） |
| 提示词 | 空镜 | 不得整镜无动作描述 |

不过门 → 把 `镜号 + 字段 + 具体错误` 回灌重写（最多 1 轮），仍不过 → 标红但保留，人工可改。

### 4. 成本与幂等

- 默认「试跑 1 集」→ 用户确认后再跑全剧（和生成页的节奏一致）
- 每集结果单独缓存（按 `ep + 剧本 hash + styleId` 做 key），重跑只跑改动的那集
- 一次调用只写一集，失败不污染其他集
- 用量照旧记进 `llm-usage.json`（`task: shots`），页面上看得到花了多少

---

## 六、实施步骤（每步可验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 契约 | 恢复 `engine/shots.mjs` 的受控词表与门禁骨架；定 `shots` 数据结构；mock 样本 | `node scripts/selftest.mjs` 新增用例全绿；`/api/shots/split` 能对 fixture 出结构 |
| P1 拆分 | `splitService`：确定性切镜 + 场覆盖 + 台词归位 | 同一剧本跑两次结果完全一致；台词不丢不重 |
| P2 提示词 | `promptBoardService`：公式 + 编号引用 + 门禁 + 重修 | mock 下 1 集全门通过；假模型返回坏值能被门挡住并重修 |
| P3 前端 | 新页面三段式（导入 → 拆分 → 提示词），单镜/单集/全集复制与导出 | 无 Key 也能走完；有 Key 时真稿可看可导 |
| P4 收尾 | 项目阶段、README、docs、冒烟与自测 | `smoke.mjs` 全过；文档同步 |

工作量估计：P0–P2 约 2 天，P3 约 1 天，P4 半天（按熟悉度浮动）。

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **许可证** | 直接拷 Seedance2 的文件/文案有合规风险 | 只借鉴结构与格式（编号、时间轴、尾帧），文字全部自己写 |
| **刚删又加，功能重叠** | 用户困惑「不是删了吗」 | 定位不同：上次是「生成整段视频提示词」，这次是「拆剧本 → 逐镜提示词」，入口在「剧本创作」域；文档写清差异 |
| **模型输出不稳定** | 提示词格式花、字段缺 | 强 schema + 14 条确定性门 + 字段级报错重修；校验逻辑全在代码里 |
| **角色/场景 ID 漂移** | 说话人/场景错位（上次踩过） | 编号只从资产层取；模型不产出 ID；合并时按 `delivery` 原名回查（沿用上次修好的方案） |
| **成本** | 60 集 × 1 次 + 重修 | 默认试跑 1 集、按集缓存、只重跑失败集；页面上先给预估调用次数 |
| **超长剧本** | 上下文爆掉 | 逐集调用，单集只带「本集 + 前后各一集摘要」；不整稿入 prompt |
| **前端卡顿** | 60 集 × 30 镜一次渲染 | 按集折叠、默认只渲染当前集；列表超过 200 行才考虑虚拟滚动 |
| **与「导入剧本」重复** | 两套入口 | 直接复用 `importCard`，不新写导入 |

---

## 八、需要你拍板

1. **方案**：A 恢复自家实现 + 重构（推荐）／B 照 Seedance2 重写／C 接 PenShot 服务
2. **首期范围**：只做 MVP（拆分 + 提示词 + 导出）／直接带 Seedance 时间轴与尾帧衔接
3. **目标模型优先级**：Seedance 2.0 优先／可灵 Vidu 通用格式都要
4. **入口位置**：剧本创作域（推荐，紧挨「AI 剧本生成」「格式转换」）／资产中心／独立一级菜单
5. **试跑策略**：默认只跑 1 集（推荐）／默认跑全剧（提示预计调用数与花费）

确认后我按 P0 → P4 推进，每阶段结束报一次验证结果。
