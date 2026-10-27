/* 分镜拆分的提示词规范。
 *
 * 方法论来源（按可复用程度排序）：
 *   1. 本地技能 seedance-storyboard（Prompt 公式、anchor phrase、Motion 清单）
 *   2. liangdabiao/Seedance2-Storyboard-Generator 的「素材编号 + 时间轴」思路（许可仅限参考，未拷用文本）
 *   3. 行业口径：60 秒成片 15–25 镜、单镜 2–6 秒、特写 2–3 秒
 * 这里只写「怎么问」，不写「怎么判」——判定全在 engine/shots.mjs。
 */
import { SHOT_SIZES, CAMERA_MOVES } from '../engine/shots.mjs';

const SIZE_LIST = Object.entries(SHOT_SIZES).map(([k, v]) => `${k}（${v}）`).join(' / ');
const MOVE_LIST = Object.entries(CAMERA_MOVES).map(([k, v]) => `${k}（${v}）`).join(' / ');

export const SPLIT_SYSTEM = `你是短剧分镜师，负责把一集剧本拆成可以直接送进视频模型的分镜段。

【两级结构：15 秒一段，段内再分子镜头】
- 每 15 秒为一个分镜段（segment）；一集按总时长拆成若干段，段与段首尾衔接。
- 每段再拆 3–6 个子镜头（建议 5 个），每个子镜头 2–4 秒，合计必须等于 15 秒。
- 子镜头的顺序 = 这一段的节奏：起 → 承 → 转 → 收，最后一个子镜头要能接住下一段的第一镜。

【你只决定"怎么切"，不重写剧情】
- 台词必须逐字保留：剧本里的每一句台词都要原样出现在某一个子镜头里，不许改字、不许删、不许合并。
- 动作可以拆，但只能拆成更小的可见动作；不许新增剧情、不许换人物、不许换场景。
- 一个子镜头只做一件事、只用一个运镜。

【镜头语言】
- 景别只能取：${SIZE_LIST}
- 运镜只能取一个：${MOVE_LIST}

【不要输出提示词正文】
时间轴提示词由服务端按你给的结构化字段拼（主体/环境/光线/时间轴/声音/风格/质量），
你只负责把每个子镜头写准。输出里不要出现 "prompt" 字段，也不要写整段提示词——
省下来的 token 都用在画面描述上，生成会快一倍。

【每个子镜头必须写清】
- visual：这一镜看得见的画面（≤30 字，主体 + 动作 + 关键道具），不要写情绪形容词。
- motion：2 条小幅度动作（如 "arm swings down" "fingers release"），不要整段描述。
- lighting：一句话光线（顶光偏冷 / 窗边侧光 / 夜景霓虹反光）。
- sec / size / move：按上面的词表，一镜一个运镜。
- 主体用角色编号（C03），不要写中文人名：视频模型只认参考图，写名字它会自己编一张脸。

只输出 JSON，不要解释、不要 Markdown 代码块。`

/**
 * 拆分请求正文。
 * 输入只给"这一集"：整稿进来模型会偷懒（漏集、砍场），逐集拆才拆得细。
 */
export function buildSplitUser({
  ep = 1, totalEps = 1, targetSeconds = 75, sceneCount = 1, episodeText = '', entry = null,
  chars = [], lines = [], castBlock = '', prevSummary = '', styleLine = '', aspect = '9:16', prevEnding = '', repair = '',
} = {}) {
  const wantSeg = Math.max(1, Math.round(targetSeconds / 15));
  return `【本集】第 ${ep} 集 / 共 ${totalEps} 集｜目标时长 ${targetSeconds} 秒｜建议 ${wantSeg} 个 15 秒段｜画幅 ${aspect}

【本集剧本（标准稿）】
${episodeText}

【本集大纲】
梗概：${entry?.synopsis ?? '（无）'}
开场钩子：${entry?.hook ?? '（无）'}
结尾卡点：${entry?.suspense ?? '（无）'}
${(entry?.scenePlan ?? []).length ? `场景计划：\n${entry.scenePlan.map((s) => `- ${s.location}：${s.event}`).join('\n')}` : ''}

${castBlock || `【出场人物（编号｜名字｜固定外观短语）】\n${chars.map((c) => `- ${c.id}｜${c.name}｜${c.anchor}`).join('\n') || '（无角色表：用剧本里出现的人）'}`}

【前情】${prevSummary || `上一集结尾：${prevEnding || '无（第一集）'}`}
${styleLine ? `【画风】${styleLine}` : ''}
${repair ? `\n【上一稿没过门，按诊断逐条修，不要改剧情】\n${repair}` : ''}

【输出】
{
  "ep": ${ep},
  "segments": [
    {
      "sceneIndex": 1,                 // 第几场（从 1 开始，必须覆盖本集每一场）
      "sec": 15,                       // 段时长，固定 15
      "beat": "冲突",                  // 钩子/铺垫/冲突/反转/高潮/结局
      "env": "幼儿园展厅，手工作品展台",
      "lighting": "室内顶光偏冷，背景虚化",
      "shots": [
        { "sec": 3, "size": "close-up", "move": "push-in", "visual": "C03 把手工作品扔进垃圾桶", "speaker": "C03", "cast": ["C03"], "line": "这东西也配摆进沈家的活动？", "motion": ["arm swings down", "fingers release"], "lighting": "顶光偏冷" },
        { "sec": 3, "size": "medium", "move": "static", "visual": "C01 抬头看向展台，手指收紧", "speaker": "", "cast": ["C01"], "line": "", "motion": ["head lifts slowly"], "lighting": "顶光偏冷" },
        { "sec": 3, "size": "extreme-close", "move": "handheld", "visual": "垃圾桶里的作品特写", "speaker": "", "cast": [], "line": "", "motion": ["dust drifts"], "lighting": "顶光偏冷" },
        { "sec": 3, "size": "medium-close", "move": "tracking", "visual": "C03 转身要走", "speaker": "", "cast": ["C03"], "line": "", "motion": ["shoulder turns"], "lighting": "顶光偏冷" },
        { "sec": 3, "size": "medium", "move": "pull-back", "visual": "C01 喊住他，画面停在两人对视", "speaker": "C01", "cast": ["C01", "C03"], "line": "站住。", "motion": ["hand reaches out"], "lighting": "顶光偏冷" }
      ]
    }
  ]
}

硬要求：不要输出 prompt 字段；每段 3–6 个子镜头、子镜头秒数合计 = 15；剧本里的每句台词原样出现在且只出现在一个子镜头；visual / motion / lighting 里不许出现中文人名（用编号）。

__TASK__: shots
__PARAMS__: ${JSON.stringify({ ep, wantSeg, targetSeconds, aspect, scenes: sceneCount, chars: chars.length, lines: lines.slice(0, 40) })}`;
}

/** 给前端展示的一句话说明（页面上的「这一次会花什么」） */
export const SPLIT_NOTE = `一次模型调用拆一集：输入本集正文 + 大纲 + 人物编号；
输出镜头表（镜号/时长/景别/运镜/画面/台词/提示词），结构由服务端确定性校验，不过门带诊断重修一轮，
仍失败则降到规则切镜（台词不丢、可继续导出）。`;
