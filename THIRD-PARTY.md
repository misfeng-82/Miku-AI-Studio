# 第三方来源清单（THIRD-PARTY）

本项目区分两种情况，**处理方式不同、不能混为一谈**：

- **A 类｜含代码/数据衍生**：文件来自上游并被修改 → 必须遵守上游许可证，已保留许可与署名。
- **B 类｜仅借鉴设计**：只参考了思路、结构或维度，**未包含上游任何代码或文本** → 不构成衍生作品，此处仅作来源透明。

> 许可证核实方式：逐个读取仓库 `LICENSE` 原文，非依据 README 自述或印象。
> 核实时间：2026-10-22 ~ 2026-10-23。

---

## A 类：含代码/数据衍生（必须遵守上游许可）

| 上游仓库 | 许可证 | 本项目落点 | 处理 |
| --- | --- | --- | --- |
| [`eternityspring/shuohao-skills`](https://github.com/eternityspring/shuohao-skills) | **Apache-2.0**<br>Copyright 2026 烁皓 | `src/engine/outline.mjs`<br>`src/engine/script.mjs`<br>`scripts/fixtures/渡口-*.json` | 已加文件头声明、已附 `LICENSE-APACHE-2.0`、已在 `NOTICE` 保留上游署名 |

---

## B 类：仅借鉴设计（未含代码）

| 上游仓库 | 许可证 | 借鉴了什么 |
| --- | --- | --- |
| [`zenstory-ai/drama-skills`](https://github.com/zenstory-ai/drama-skills) | MIT | 可拍摄性原则 |
| [`honolulu0/llm-script-factory`](https://github.com/honolulu0/llm-script-factory) | MIT | 六阶段流水线结构（裁为三段） |
| [`Forget-C/Jellyfish`](https://github.com/Forget-C/Jellyfish) | 未核实 | 三态分离、五级降级 JSON 解析 |
| [`waooAI/waoowaoo`](https://github.com/waooAI/waoowaoo) | 未核实 | 参考图抽象、场景保真 |
| [`0xsline/short-drama`](https://github.com/0xsline/short-drama) | **MIT**（Copyright 2025 0xsline） | 合规清单维度、商业化节奏设计 |
| [`geegl/directorskills`](https://github.com/geegl/directorskills) | MIT | skill 的 R/I/A/E/B 组织方式 |
| [`mengxiujie/ManjuForge`](https://github.com/mengxiujie/ManjuForge) | MIT-0 | 多记忆文件一致性检查思路 |
| [`suihe1/short-drama-production`](https://github.com/suihe1/short-drama-production) | Apache-2.0 | 制品哈希与失效传播思路、声音资产分层 |
| [`VanGong1999/screen-creative-skills`](https://github.com/VanGong1999/screen-creative-skills) | **MIT**（Copyright 2026 宫凡） | 小说改编评估的维度设计 |
| [`HBAI-Ltd/Toonflow-app`](https://github.com/HBAI-Ltd/Toonflow-app) | **MIT**（Copyright 2026 HBAI-Ltd） | 无限画布交互思路 |
| `YumingScroll` / `generate-comic-drama-video` / `ai-short-drama-studio` / `anime-ai-studio` / `manju-workbench` / `omni-workbench` / `manga-studio` | 未核实 | 提示词库、token 纪律、工作台架构 |

---

## ⛔ 明确不引入（许可证红线）

| 仓库 | 许可证 | 原因 |
| --- | --- | --- |
| [`ArcReel/ArcReel`](https://github.com/ArcReel/ArcReel) | **AGPL-3.0** | 本项目已部署公网；AGPL 第 13 条要求向网络用户提供修改版源码，会传染整个项目。**只读设计，不引入任何代码** |
| [`Narcooo/inkos`](https://github.com/Narcooo/inkos) | **AGPL-3.0** | 同上 |
| `shuyu-labs/BigBanana-AI-Director` | CC BY-NC-SA 4.0 | 禁商用；且仓库已停止发布源码 |
| `chatfire-AI/huobao-drama` | CC BY-NC-SA 4.0 | 禁商用，只可借鉴流程思路 |

---

## 数据与商标

`src/assets/hotDramas.js`、`data/hot-dramas.json` 中的剧目名称、集数、海报 URL、播放页链接，
均来自公开榜单页面，**版权归各平台与权利人所有**。本项目将其作为公开信息引用，用于研究爆款结构，
**不主张任何权利，亦不代表与红果短剧等平台存在合作或授权关系**。

如需商用或对外发布，请自行确认榜单数据的引用合规性。

---

> 本文档为工程层面的许可整理，**不构成法律意见**。
> 如需应对正式合规审查，请交由法务确认。
