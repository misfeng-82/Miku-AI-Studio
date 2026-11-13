# 无限画布 · Infinite Canvas

节点式 AI 画布：卡片编排、贝塞尔连线、**真实调用模型出图/出片**。
交互对标 [mitoneai 觅糖画布](https://mitoneai.com/canvas)，生成走 AutoDL Art 的 ComfyUI 工作流。

## 启动

```bash
cd infinite-canvas
npm install          # express + dotenv
cp .env.example .env # 填 AUTODL_TOKEN
npm start            # → http://127.0.0.1:5180
```

## 生成能力从哪来：两条路，两把令牌

| 类型 | 接口 | 令牌分组 | 是否异步 |
|---|---|---|---|
| **视频** | AutoDL ComfyUI 工作流 | **ComfyUI** | 提交 → 轮询（15 秒镜头约 2–3 分钟） |
| **图片** | `/api/v1/images/generations`（OpenAI 兼容） | **LLM** | 同步，一次请求就出图 |

⚠️ 这两把令牌**不能混用**：ComfyUI 分组令牌调模型列表返回 0 个模型，
LLM 分组令牌调 ComfyUI 接口返回 403。所以「接 API」弹窗里分两个输入框。

视频走 **AutoDL Art · ComfyUI 工作流 API**（[文档](https://www.autodl.art/docs/api/comfyui_api/)），
两步走：提交拿 `task_id` → 轮询 `result`。默认接两个工作流：

| 场景 | 工作流 ID |
|---|---|
| 文生视频（无参考图） | `minimax_h3_lightx2v_no_pic` |
| 图生视频（多图 + 多音频，最多 9 图 3 音） | `minimax_h3_image_audio_to_video_v2_15s` |

节点有参考图就走图生视频，没有就走文生视频，逻辑在 `server.js` 的 `/api/generate` 里。

### ⚠️ 令牌必须选对分组

AutoDL 的令牌分两种分组，**用错了接口直接 403**：

```
{"error":{"message":"This token does not have permission to access ComfyUI APIs","type":"permission_denied"}}
```

去 [autodl.art/large-model/tokens](https://autodl.art/large-model/tokens) → 创建令牌 →
**分组选 `ComfyUI`** → 复制到 `.env` 的 `AUTODL_TOKEN`。
普通 LLM 分组的令牌只能调对话模型，调不了工作流。

界面右上角会实时显示状态：
- 绿点「模型已接入」= 权限正常，能真出片
- 黄点「令牌缺 ComfyUI 权限」= 令牌能用但分组不对
- 黄点「未配置令牌」= 只能跑模拟

### 图片提示词的坑：别写「电影感」

图片接口的审核对中文比较敏感，实测：

| 提示词 | 结果 |
|---|---|
| 厨房，粗陶碗，两个鸡蛋 | ✅ 通过 |
| 厨房里，木桌上放着一个碗，碗底有两个鸡蛋，暖色灯光 | ✅ 通过 |
| 厨房，碗，鸡蛋，**电影感** | ❌ 被拦 |
| 写实**电影感**，厨房 | ❌ 被拦 |
| a cat on a windowsill, cinematic photo | ✅ 通过 |

**「电影感」这个词必挂**，换成「真实摄影质感 / 高质量摄影」即可；英文 `cinematic` 反而没问题。
被拦时的返回是 `Your input contains content restricted by our safety guidelines`。

### 计费

按秒计，480p 约 **0.04 元/秒**，15 秒一镜 ≈ 0.6 元；768p 约 0.05 元/秒。
每次点「运行」都是一次真实提交，**没有二次确认弹窗**——测试时把提示词写短、时长调到最小。

## 技术栈

| 层 | 选择 |
|---|---|
| 服务端 | Node 18+ / Express 4 / dotenv，`fetch` 直连 AutoDL |
| 前端 | 原生 ES Modules（无框架、无打包器），CSS `transform` 驱动视口 |
| 连线 | 内联 SVG + 贝塞尔 + marker 箭头，透明粗线做命中 |
| 节点 | 绝对定位 DOM（卡片里要放 textarea / 下拉 / 视频，位图方案做不了） |
| 状态 | 单 state + 快照式撤销 + localStorage |
| 存储 | 暂无后端持久化，画布存浏览器；生成结果在节点上（链接 24 小时有效） |

## 目录结构

```
infinite-canvas/
├── server.js               Express + 生成接口（提交 / 查询 / 等待 / 状态探测）
├── .env / .env.example     AUTODL_TOKEN、工作流 ID、默认参数
├── package.json
└── public/
    ├── index.html          顶栏 / 左面板 / 画布 / 工具栏 / 小地图 / 双击菜单
    ├── styles.css
    └── app/
        ├── main.js         视口、渲染、手势、面板、运行调度
        ├── store.js        状态 + 撤销 + 持久化
        └── nodes.js        六种节点定义与卡片模板
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 令牌是否配置、有没有 ComfyUI 权限、当前工作流 |
| POST | `/api/generate` | 提交任务 `{kind: 'image'\|'video', prompt, ratio, resolution, duration}`；图片同步返回 `done:true` |
| GET | `/api/generate/:taskId` | 查一次 |
| POST | `/api/generate/wait` | 一次等到底（前端点运行就用这个） |

`FORCE_MOCK=1` 时全部走模拟，不发真实请求、不产生费用。

## 画布功能

- 滚轮缩放（以光标为中心）、空白拖拽平移、`空格`+拖拽、中键拖拽
- **节点卡片上直接切「图片 / 视频」**：切换后标题、预览区、参数（比例 / 时长 5s·10s·15s）一起变，提示词保留
- 新建节点后光标自动落进提示词框，不用再点一下
- **空白处右键** → 菜单：文生图 / 文生视频 / 文本 / 分镜 / 适应画布
- 右键选「文生图 / 文生视频」→ 弹窗里**直接写提示词 + 选比例/时长**，可「只建节点」或「创建并生成」
- 双击空白 → 类型菜单；空态六个快捷胶囊；底部工具条快速加节点
- **点卡片里的预览图/视频 → 弹大窗播放**（卡片内是小尺寸，视频没控件，靠点开看）
- 六种节点：图片生成 / 视频生成（两者可互切）/ 音频生成 / 文本剧本 / 脚本分镜 / 智能剪辑
- 运行：进度条推进 → 出结果（图片直接显示、视频可播）→ 徽章变「已完成」；失败时卡片底部显示上游原始报错
- 连线：拖端口 或 `L` 进连线模式；选中节点时上下游高亮；点连线可删
- 整理画布：按数据流算深度分层自动排布；网格吸附 20px
- 左面板节点列表实时同步、搜索、按类型筛选、点击定位
- 小地图、撤销重做、`Ctrl+Z` / `Delete` / `F` 适应画布

## 已知边界

- **画布数据存在浏览器**，换设备看不到。要多人共用需要加后端存储。
- **结果链接 24 小时失效**：AutoDL 返回的是临时地址，要留的片子得尽快下载或转存。
- **模型下拉是真实列表**，不是写死的：图片模型从 `/api/v1/models` 里筛 image 相关动态拉取
  （`gpt-image-2` / `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` / `Qwen-Image` / `Z-Image-Turbo`），
  视频下拉列的是真实工作流 ID。**选中哪个就提交哪个**，不再只是装饰。
- **图片尺寸必须能被 16 整除**：代码里按比例映射成 1024×1536 / 1024×1024 / 1536×1024。
- 节点上的「模型」下拉目前只是展示项，实际用哪个工作流由 `.env` 决定。
