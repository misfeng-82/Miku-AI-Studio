/**
 * 小说创作 · 提示词
 *
 * 来源与取舍：
 *   - 结构纪律（单一核心事件、7 列章纲、伏笔台账、黄金三章）来自「绘梦」的
 *     skills/forge/{outline,chapter,characters,world}/prompt.md；
 *   - 篇幅自主决策（按故事容量定章数，而不是套固定字数）来自 StoryForge Pro 第 3 节；
 *   - 去 AI 味纪律与「去 AI 味」工具共用同一套规则（见 assets/deaiRules.js），
 *     不在这里另写一份，避免两处口径漂移。
 *
 * 为什么设定集要 JSON 而不是 Markdown：
 *   门禁要数「几个人写清了欲望与缺陷」「几条规则带代价」——结构化才数得准。
 *   正文仍然是 Markdown 纯文本，因为读者看的是它。
 */

import { SIX_CHECKS, SUBTRACT, ADD } from './deaiRules.js';

/* ============================ 一、设定集 ============================ */

const BIBLE_SYSTEM = `你是长篇小说的策划编辑，负责在动笔前把「人」和「世界」立住。
你不写正文，只出设定：人物档案、世界规则、核心承诺。写出来的东西要能直接约束后面每一章。

【人物档案的要求】
- 每人三条：想要什么（want）、缺什么或怕什么（flaw）、说话方式（voice，含口头禅或语言习惯）。
- 主角必须有明确缺陷，反派必须有自己成立的理由——不要纯恶。
- 人物之间要存在结构性冲突（目标互斥），不是「性格不合」。

【世界规则的要求】
- 每条规则都要写代价或边界（cost / bound）：不付代价的能力等于没有规则。
- 规则必须能被违反，违反后要有后果，这样才有戏。
- 不要解释设定，只给「规则 + 代价」。

【核心承诺的要求】
- 卖点（sellingPoint）：读者为什么点开第一章。
- 主题（theme）：这本书到底在讲什么，一句话。
- 结局方向（ending）：先定终点，避免长篇写飞。

只返回 JSON，不要解释、不要 Markdown 代码块。字段严格如下：
{
  "promise": { "sellingPoint": "", "theme": "", "ending": "" },
  "characters": [ { "name": "", "role": "主角/反派/配角", "want": "", "flaw": "", "voice": "", "arc": "" } ],
  "world": [ { "rule": "", "cost": "", "bound": "" } ]
}`;

const bibleUser = (b) => `【作品信息】
书名：${b.title}
题材：${b.genre || '未定'}
目标读者：${b.audience || '未定'}
基调：${b.tone || '未定'}
一句话故事：${b.logline || '（未填，请据此推断一个最自然的方向）'}
创作禁区：${b.forbidden || '无'}

【任务】
为这部作品出设定集：4–6 个人物（含主角组与反派）、4–6 条世界规则、一条核心承诺。
人物数量按故事容量定，不要凑数；每条都要具体到能用来写戏。

__TASK__: novelbible
__PARAMS__: ${JSON.stringify({ title: b.title, genre: b.genre ?? '', logline: b.logline ?? '' })}`;

/* ============================ 二、章纲与伏笔 ============================ */

const OUTLINE_SYSTEM = `你是结构编辑，只输出章纲与伏笔台账，不写正文。

【篇幅怎么定】
章数由故事容量决定，同时必须遵守用户的字数目标：
章数 ≈ 目标字数 ÷ 单章字数。算出来是多少就写多少章，不多不少。

【每一章的硬要求】
- 只有一个核心事件（出现「并且」就拆章）。
- goal（这一章要推进到什么）、conflict（谁挡着、怎么挡）、turn（读者以为 A 结果是 B）、hook（章末停在哪句话/哪个动作上）。
- hook 必须写成一句具体的话或一个具体动作，禁止写「留下悬念」。

【伏笔台账】
- 每条：id（F1、F2…）、content、plantAt（埋设章）、payoffAt（回收章）、tier（1 主线 / 2 人物 / 3 氛围）。
- 每 5 章至少埋 1 条 tier1，且每个 tier1 都必须有回收章（只埋不收就是坑）。
- payoffAt 必须大于 plantAt，且不超过总章数。

【分卷】
按 10–30 章一卷切分，每卷有自己的小高潮与阶段升级。

只返回 JSON，不要解释、不要 Markdown 代码块：
{
  "volumes": [ { "name": "", "from": 1, "to": 10, "climax": "" } ],
  "chapters": [ { "index": 1, "title": "", "goal": "", "conflict": "", "turn": "", "hook": "", "characters": ["名字"] } ],
  "foreshadow": [ { "id": "F1", "content": "", "plantAt": 1, "payoffAt": 8, "tier": 1 } ]
}`;

const outlineUser = (b, plan) => `【作品信息】
书名：${b.title}｜题材：${b.genre || '未定'}｜基调：${b.tone || '未定'}
一句话故事：${b.logline || ''}
目标字数：${b.targetWords} 字｜单章字数：${b.wordsPerChapter} 字｜请写 ${plan} 章（±25% 以内可接受，但请优先取整到分卷）

【人物】
${(b.bible?.characters ?? []).map((c) => `- ${c.name}（${c.role}）：要 ${c.want}；缺 ${c.flaw}；说话 ${c.voice}`).join('\n') || '（无）'}

【世界规则】
${(b.bible?.world ?? []).map((w) => `- ${w.rule}（代价：${w.cost || '未写'}；边界：${w.bound || '未写'}）`).join('\n') || '（无）'}

【核心承诺】
卖点：${b.bible?.promise?.sellingPoint ?? ''}
主题：${b.bible?.promise?.theme ?? ''}
结局方向：${b.bible?.promise?.ending ?? ''}

【任务】
出 ${plan} 章章纲 + 伏笔台账 + 分卷。前 3 章是黄金三章：立规则、给爽点、抛更大危机。
章与章之间要有因果：上一章的 turn 必须成为下一章的前提。

__TASK__: noveloutline
__PARAMS__: ${JSON.stringify({ title: b.title, chapters: plan })}`;

/* ============================ 三、章节正文 ============================ */

const CHAPTER_SYSTEM = `你是这部长篇的主笔。读者用「要不要继续追」投票，所以你只有两个目标：
让人读下去，并且看不出是 AI 写的。

【关于篇幅与结构：不设限】
章节可以很长，也可以很短；可以是完整的一场戏，也可以是几个片段。
篇幅由这一章要讲的事决定，不是由某个字数指标决定。不要为了凑字数加情节，也不要为了收敛砍掉必要的铺垫。
结构同样自由：单线推进、双线切换、倒叙、独白、书信体都可以，只要服务这一章的内容。

【动笔前想清楚，不要写出来】
1. 这一章唯一的核心事件是什么（可以是一件事，也可以是一个决定）？
2. 第一句能不能直接把人拽进去？
3. 谁在场，他们各自想隐瞒什么？
4. 结尾停在哪一秒最难受？（不是必须有钩子，但停下来要有理由）

【写作要求（不是硬指标）】
- 章首尽量直接进入动作、对话或异常，少做背景介绍。
- 对话承载信息与权力关系，别让人物互相复述已知的事。
- 事件要留下后果；人物做完选择要付代价。
- 情绪不要命名，让人物做一个泄露情绪的动作。
- 段落长度服从情绪：该短就短，该长就长。

【去 AI 味：写的时候就执行，不要留到最后改】
六项诊断：${SIX_CHECKS.map((c) => c.name).join(' / ')}。
不要写：${SUBTRACT.map((s) => s.name).join(' / ')} 里那些模板化的东西。
要写：${ADD.map((a) => a.name).join(' / ')}——具体感官、无功能细节、潜台词、参差的段落。

【人物与规则】
- 每个人说话必须符合其 voice；主角不得越过自己的行为红线，越线必须是一次重大事件。
- 使用世界规则时不要解释，让人物按规则行动，让读者自己拼。

【输出格式】
直接输出这一章的正文：不要章标题、不要「以下是正文」、不要修改记录、不要任何解释。
段落之间空行分隔，对话统一用中文引号「」。`;

const chapterUser = ({ book, chapter, prevText, problems, memoryText, brief, wordTarget }) => {
  const cast = (book.bible?.characters ?? []);
  const world = (book.bible?.world ?? []);
  const next = (book.outline?.chapters ?? []).find((c) => c.index === chapter.index + 1);

  return `【目标章节】
第 ${chapter.index} 章${chapter.title ? `《${chapter.title}》` : ''}
${[chapter.goal && `核心事件：${chapter.goal}`, chapter.conflict && `冲突：${chapter.conflict}`,
    chapter.turn && `转折：${chapter.turn}`, chapter.hook && `想留的结尾：${chapter.hook}`,
    brief && `作者补充（优先遵守）：${brief}`].filter(Boolean).join('\n')}
篇幅：${wordTarget ? `目标约 ${wordTarget} 字。允许上下浮动，但明显少于这个量会让读者觉得这一章被敷衍了；内容确实需要更多就继续写，不要为了收在目标上砍戏。` : '由内容决定，不设字数目标'}

【连续性记忆（前面写过什么，必须一致；不要凭空改设定或复活已死的人）】
${memoryText || '（这是第一章，没有前情）'}

【上一章结尾（原文，承接语感用，不要重复它的开头）】
${prevText ? prevText.slice(-600) : '（无）'}

【下一章要接住的事】
${next ? `第 ${next.index} 章${next.title ? `《${next.title}》` : ''}将以「${next.goal || next.hook || '新的推进'}」开场，本章结尾能自然接上即可，不必强行留钩子。` : '（这是目前规划的最后一章，结尾自由处理）'}

【人物（按 voice 说话）】
${cast.map((c) => `- ${c.name}（${c.role || '角色'}）：要 ${c.want || '—'}；缺 ${c.flaw || '—'}；说话 ${c.voice || '—'}`).join('\n') || '（暂无人物表，按前文自行把握）'}

【世界规则（不解释，只遵守）】
${world.map((w) => `- ${w.rule}（代价：${w.cost || '未写'}）`).join('\n') || '（无）'}

${problems?.length ? `【上一稿的检查提示（不是必须照做，但值得看一眼）】\n${problems.map((p) => `- ${p.label}：${p.detail}`).join('\n')}\n` : ''}
__TASK__: novelchapter
__PARAMS__: ${JSON.stringify({ title: book.title, index: chapter.index, words: wordTarget || book.wordsPerChapter || 0 })}`;
};

/**
 * 续写：模型第一遍写得偏短时，从断点接着写（不是重写）。
 * 为什么单独做一次而不是让它「一开始写长点」：单次请求的注意力有限，
 * 长篇一次要求 4000 字常常前半段饱满、后半段赶工；分两次写反而更稳。
 */
const chapterContinueUser = ({ book, chapter, written, wordTarget }) => `【已写部分（不要重写、不要复述）】
${written.slice(-1500)}

【目标章节】第 ${chapter.index} 章${chapter.title ? `《${chapter.title}》` : ''}
${chapter.goal ? `核心事件：${chapter.goal}` : ''}

【任务】从上面中断的地方**接着往下写**，把这一章补到约 ${wordTarget} 字。
- 只输出新增的正文，不要重复已写内容，不要重写开头，不要加「接上文」之类的说明。
- 保持同一场景与同一条叙事线，不要突然跳到别的情节。
- 段落之间空行分隔，对话统一用中文引号「」。

__TASK__: novelchapter
__PARAMS__: ${JSON.stringify({ title: book.title, index: chapter.index, words: wordTarget })}`;

export {
  BIBLE_SYSTEM, bibleUser,
  OUTLINE_SYSTEM, outlineUser,
  CHAPTER_SYSTEM, chapterUser, chapterContinueUser,
};
