/*
 * AI 短剧框架库 —— 「这一部短剧按什么套路搭结构」。
 *
 * 和「题材」是两个维度，必须分开：
 *   题材（女频逆袭 / 悬疑 / 萌宝…）决定**用什么词**、什么人物关系；
 *   框架（复仇逆袭流 / 悬疑钩子流 / 重生先知流…）决定**结构怎么搭**：
 *   第 1 集前几拍发生什么、每集几个回合、打脸密不密、集尾留什么扣。
 * 同一个题材换框架，出来的是一部结构完全不同的剧——这才是「框架选择要多样化」的意思。
 *
 * 每条的字段都有实际用途，不是文案：
 *   hint    界面上一行说明
 *   opening 第 1 集开篇的硬要求（进大纲 prompt）
 *   spine   每一集的骨架要求（进大纲 + 剧本两段 prompt）
 *   cliff   集尾悬念的类型要求
 *   beats   节拍类型序列（样本引擎按它排节拍；真模型走 spine/opening）
 *   majorAt 序列里哪几个位置算大爆点（决定 major 爽点的落点）
 */

export const FRAMEWORKS = Object.freeze([
  {
    id: 'auto',
    label: '自动（按题材选）',
    hint: '不指定框架，让模型按你的题材挑一个最合适的结构',
    opening: '第 1 集前 3 拍必须把主角的处境和他的目标摆到台面上，钩子落在具体的一件东西上。',
    spine: '每集至少一个完整的「打压—反打」回合，集尾留一个未揭的筹码。',
    cliff: '未揭的筹码或身份类悬念。',
    beats: ['悬念钩', '危机', '打脸', '反转', '爽点'],
    majorAt: [2, 4],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'both', 'release', 'both'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'revenge',
    label: '复仇逆袭流',
    hint: '开篇受辱 → 隐忍布局 → 逐集打脸 → 终局翻盘',
    opening: '第 1 集开场就把「受辱」演出来（当众被撕、被夺、被逐），最后一拍给主角一个具体的复仇由头。',
    spine: '每集一个明确的打压—反打回合：先让对手占到便宜，再由主角用一件早已备好的证据/筹码打回去。',
    cliff: '对手下一步的杀招，或主角手里还压着的那张牌。',
    beats: ['悬念钩', '危机', '隐忍', '打脸', '反转', '爽点'],
    majorAt: [3, 5],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'press', 'release', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'suspense',
    label: '悬疑钩子流',
    hint: '每集一个新疑点，集尾必留扣，终集揭底',
    opening: '第 1 集前 3 拍出现一个反常细节（物件、伤痕、时间对不上），主角因它被卷进去。',
    spine: '每集推进一个疑点、同时推翻上一集的解释；线索要在画面上看得见（道具/特写），不能只靠台词说。',
    cliff: '一个新出现的反常事实，或上一个解释被推翻的瞬间。',
    beats: ['悬念钩', '线索', '误导', '反转', '揭示'],
    majorAt: [3],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'press', 'both', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'identity',
    label: '身份错位流',
    hint: '主角藏着真实身份，被低估 → 层层揭示',
    opening: '第 1 集让主角被当成小人物对待（被使唤、被看不起），但同时给一个只观众看得见的身份细节。',
    spine: '每集至少一次「身份被低估」和一次「小范围露锋」；真身份分层揭，一集只揭一层。',
    cliff: '有人开始怀疑主角的身份，或一件旧物被人认出。',
    beats: ['悬念钩', '低估', '露锋', '反转', '亮身份'],
    majorAt: [4],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'release', 'press', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'rebirth',
    label: '重生先知流',
    hint: '带着记忆重来，抢在对手之前布局',
    opening: '第 1 集开场就是死局（死亡/被弃/家破），最后一拍睁眼回到从前，并且说出一件只有她知道的事。',
    spine: '每集用一次「先知」抢下先手，但代价是让对手察觉异常；不能一路顺，要留一次失算。',
    cliff: '历史被改变后出现的新变数，或对手的反制。',
    beats: ['悬念钩', '先知', '抢手', '危机', '打脸', '反转'],
    majorAt: [3, 5],
    springPlan: ['both', 'press', 'release', 'press', 'press', 'release', 'both', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'sweet',
    label: '甜宠恋爱流',
    hint: '误会开局 → 关系升温 → 外部阻碍 → 双向奔赴',
    opening: '第 1 集让两人因为一件尴尬的事被迫绑定（契约、合租、替班），最后一拍出现第一次在意。',
    spine: '每集一个「靠近—退缩」的小回合，情感推进必须靠事件（不是靠旁白），外部阻碍每 2 集加码一次。',
    cliff: '一个打断关系的误会或外人介入。',
    beats: ['悬念钩', '绑定', '心动', '误会', '靠近', '阻碍'],
    majorAt: [2, 5],
    springPlan: ['both', 'press', 'release', 'press', 'release', 'press', 'release', 'both'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'baby',
    label: '萌宝亲情流',
    hint: '孩子牵线，误会解开，血脉真相浮出',
    opening: '第 1 集让孩子先出场并做一件反常的事（画出案发现场、说出一句大人的话、认出一个陌生人）。',
    spine: '每集由孩子推动一次大人世界的转折；孩子的台词要短、要天真但不能幼稚，信息量靠「说漏嘴」。',
    cliff: '孩子说出的半句话，或一份指向血缘的凭证。',
    beats: ['悬念钩', '童言', '线索', '误会', '揭示', '团圆'],
    majorAt: [3],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'release', 'both', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'warGod',
    label: '战神归来流',
    hint: '强者隐姓埋名 → 被欺 → 身份揭晓 → 碾压',
    opening: '第 1 集主角以最低身份出场（上门女婿、司机、保安），被直系亲属当众羞辱。',
    spine: '每集一次「被欺到底」再「轻描淡写打回去」；主角的强要靠结果体现，不靠自称，也不早亮底牌。',
    cliff: '一个更高层级的人开始追查主角的真实身份。',
    beats: ['悬念钩', '被欺', '隐忍', '反击', '亮身份', '碾压'],
    majorAt: [3, 5],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'press', 'release', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'family',
    label: '豪门争斗流',
    hint: '家产／继承权之争，人心算计层层加码',
    opening: '第 1 集就摆出一份遗产／股权／继承权，并且明确谁最想要、谁最不配。',
    spine: '每集一次利益交换或背叛（谁跟谁结盟、谁反水）；用饭桌、会议、账本这类场景承载算计。',
    cliff: '一份新出现的文件、口供或录音。',
    beats: ['悬念钩', '算计', '结盟', '背叛', '反转', '定局'],
    majorAt: [3, 5],
    springPlan: ['both', 'press', 'press', 'release', 'press', 'press', 'release', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'rise',
    label: '小人物逆袭流',
    hint: '从底层起步，一步一个台阶往上爬',
    opening: '第 1 集开场主角正在为一件很小的事发愁（房租、学费、一单活），而这件事牵出更大的局。',
    spine: '每集上一个台阶（多一个客户、多一条路、多一个盟友），台阶必须用具体数字或具体物件体现。',
    cliff: '下一级台阶上出现的拦路人。',
    beats: ['悬念钩', '困境', '抓机会', '小胜', '新人脉', '反转'],
    majorAt: [3, 5],
    springPlan: ['both', 'press', 'release', 'press', 'press', 'release', 'press', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
  {
    id: 'crash',
    label: '强冲突开局流',
    hint: '开场 3 秒进冲突，快节奏、密钩子',
    opening: '第 1 集第 1 拍就是冲突现场（离婚现场、抓奸、车祸、当众解约），不给铺垫。',
    spine: '每集 2 个反转、4 个钩子点；台词短、动作多，任何一个场景都不许超过 3 个回合的平静对话。',
    cliff: '每个反转落点都当集尾用（本框架集尾悬念要最密）。',
    beats: ['冲突', '反击', '反打', '危机', '反转', '爽点'],
    majorAt: [1, 3, 5],
    springPlan: ['both', 'press', 'release', 'press', 'release', 'press', 'release', 'release'], // 每集的弹簧定位：press 只压 / release 释放 / both 压放结合
  },
]);

export const DEFAULT_FRAMEWORK_ID = 'auto';

export const frameworkById = (id) => FRAMEWORKS.find((f) => f.id === id) ?? FRAMEWORKS[0];

/** 大纲 prompt 的框架段：把结构要求原样写进去，模型照这个搭结构 */
export function frameworkBlock(id) {
  const f = frameworkById(id);
  if (f.id === 'auto') {
    return [
      '短剧框架：由你根据题材挑一个最合适的（开场方式、每集回合数、集尾悬念类型都要围绕它统一），并在 adaptation.core 里写明你选了哪个框架。',
      '通用结构要求：每集至少一个完整回合（打压—反打 或 疑点—推翻），集尾必须留悬念。',
    ];
  }
  return [
    `短剧框架：${f.label}（${f.hint}）—— 全剧结构必须照这个框架搭，不许写成别的套路。`,
    `开篇：${f.opening}`,
    `每集骨架：${f.spine}`,
    `集尾悬念类型：${f.cliff}`,
  ];
}

/** 剧本 prompt 的框架段：写完大纲后再强调一次，避免逐集跑偏 */
export function frameworkSpine(id) {
  const f = frameworkById(id);
  return f.id === 'auto'
    ? '按大纲里选定的框架写；每集一个完整回合，集尾留悬念。'
    : `本部戏按「${f.label}」写：每集骨架是「${f.spine}」；集尾悬念用「${f.cliff}」。`;
}

/** 样本引擎用的节拍序列（真模型走 prompt，样本引擎走这张表） */
export function frameworkBeatSeq(id) {
  const f = frameworkById(id);
  return { types: f.beats, majorAt: f.majorAt };
}

/* ================================================================
   弹簧定位：每一集的「情绪功能」
   短剧的每一集只做两件事之一——压弹簧（制造压抑、积累情绪）或
   放弹簧（反转、打脸、真相、释放）。工业做法里这是**硬性判据**：
   「既不压也不放」的中间状态集 = 不合格集。
   首集例外：它是独立引流集，当集必须完成一个小闭环，固定用 both。
   ================================================================ */
export const SPRINGS = Object.freeze({
  press: { label: '压弹簧', hint: '只制造困境、误会、压制，本集不给任何反转' },
  release: { label: '放弹簧', hint: '承接前面积累的压抑，本集给出明确的反转与释放' },
  both: { label: '压放结合', hint: '前半段压、后半段放，当集完成一个小闭环' },
});

export const SPRING_IDS = Object.freeze(Object.keys(SPRINGS));
export const springLabel = (id) => SPRINGS[id]?.label ?? SPRINGS.both.label;

/** 按框架 + 集数算出每集弹簧定位；首集强制 both（独立引流集，当集闭环） */
export function frameworkSpringPlan(id, episodes) {
  const f = frameworkById(id);
  const plan = f.springPlan ?? frameworkById(DEFAULT_FRAMEWORK_ID).springPlan;
  const n = Math.max(1, Number(episodes) || plan.length);
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'both' : plan[i % plan.length]));
}

/** 剧本 prompt 用：把这一集的节奏定位写成给模型的硬指令 */
export function springInstruction(spring) {
  const s = SPRINGS[spring] ?? SPRINGS.both;
  const lines = [`本集节奏定位：${s.label}——${s.hint}。`];
  if (spring === 'press') {
    lines.push('硬要求：本集只加压、不解决。不许在本集给出反转、打脸或真相，结尾必须停在「压力升级」的钩子上。');
  } else if (spring === 'release') {
    lines.push('硬要求：本集承接前面积累的压抑，给一次明确的反转／打脸／真相；结尾立刻抛一个更大的新钩子。');
  } else {
    lines.push('硬要求：前半段加压、后半段释放，本集内部完成一个小闭环；结尾抛出新钩子。');
  }
  return lines.join('\n');
}

/**
 * 写作纪律：短剧剧本的反模式禁令。
 * 取自开源方法体系里被反复验证的几条「AI 通病拦截」，全部是可判定的硬规矩——
 * 不是文风偏好，命中任意一条这一集就不好看。
 */
export const WRITING_DISCIPLINE = Object.freeze([
  '1. 集内情节点不超过 2 个：最强的那个爆点必须写满——层层反应、对手戏来回拉扯、微动作，禁止两句就跳走。',
  '2. 每句台词都要读得出谁高谁低、谁在压谁在忍；删掉之后人物关系毫无变化的台词就是水词，删掉。',
  '3. 只写摄像机能拍到的东西：动作、表情、台词。禁止心理旁白，禁止「仿佛／像在哭泣」式比喻，禁止用省略号做气口。',
  '4. 环境描写每集不超过 2 句、每句不超过 15 字，且必须与剧情有因果关系（道具型），不做氛围渲染。',
  '5. 除第 1 集外，本集开头必须承接上一集结尾：用一句话锚定时间差，或延续上一集的场景／人物状态。',
]);

/** 集间承接方式（第 2 集起必须四选一，写进大纲） */
export const CARRY_OVER_MODES = Object.freeze([
  { id: 'time', label: '时间锚定', hint: '开头一句交代时间差（几小时后／次日／三天后），并接住上一集的人物位置' },
  { id: 'scene', label: '场景延续', hint: '仍在上一集结尾的同一场景继续往下写' },
  { id: 'state', label: '状态承接', hint: '从上一集结尾某人的动作／表情／没说完的话接着写' },
  { id: 'unit', label: '单元换章', hint: '上一个情节单元已收口，本集开新单元' },
]);
export const carryOverLabel = (id) => CARRY_OVER_MODES.find((m) => m.id === id)?.label ?? '场景延续';
