/**
 * 去 AI 味 · 规则库（确定性数据，不依赖模型）
 *
 * 来源：移植自「绘梦」data/banks/anti-ai-rules.json（10 条本机规则）
 * 与 skills/forge/deai/prompt.md（六项诊断 / 减法 7 项 / 加法 5 项）。
 *
 * 为什么规则要单独放一个文件而不是写死在提示词里：
 *   同一份规则要被三处消费——改写提示词、前端展示、扫描器解释扣分原因。
 *   写死在提示词里，前端就没法展示「它凭什么扣我分」，用户只能看着分数干着急。
 */

/** 本机规则：10 条，全部是「可执行的动作」而不是「要写得更好」这种废话 */
export const RULES = Object.freeze([
  {
    id: 'no-adverb-emotion',
    name: '避免副词承接情绪',
    type: '禁用',
    severity: '高',
    rule: '不要用「不禁 / 不由得 / 仿佛 / 宛如」来承接情绪',
    fix: '用动作分解代替副词承接',
    example: '他不禁笑了 → 他笑了一下',
  },
  {
    id: 'emotion-via-action',
    name: '情绪由动作外露',
    type: '禁用',
    severity: '高',
    rule: '不要直接命名情绪，让动作泄露情绪',
    fix: '动作 + 反常细节',
    example: '他很愤怒 → 他把杯子放回桌上，放得太轻了',
  },
  {
    id: 'no-explainer',
    name: '禁止解释性旁白',
    type: '禁用',
    severity: '高',
    rule: '不要写解释性旁白（他明白了 / 这意味着 / 换句话说）',
    fix: '删掉解释，保留动作',
    example: '他明白了，这一切都是局 → 他把手机扣在桌上，屏幕朝下',
  },
  {
    id: 'paragraph-variety',
    name: '段落参差',
    type: '鼓励',
    severity: '中',
    rule: '段落长度必须参差，长段之后给一个一行短段',
    fix: '按情绪节奏切段',
    example: '连续 5 段都是 4 行 → 改为 3 段长 + 1 段一行',
  },
  {
    id: 'break-triad',
    name: '打破三连排比',
    type: '禁用',
    severity: '中',
    rule: '不要连续三句同长度、同开头',
    fix: '打断其中一句的节奏或主语',
    example: '他站住。她回头。风停了。 → 他站住，她在这时才回头。风停了。',
  },
  {
    id: 'no-abstract-pile',
    name: '少堆抽象名词',
    type: '警告',
    severity: '中',
    rule: '命运 / 意义 / 灵魂 / 痛苦 这类抽象名词不要成串出现',
    fix: '换成可看见、可听见、可摸到的东西',
    example: '他感受到命运的重量 → 他把那张纸对折了两次，塞进内袋',
  },
  {
    id: 'dialog-subtext',
    name: '对话留潜台词',
    type: '鼓励',
    severity: '中',
    rule: '人物不要把知道的全部说出来，至少三成对话信息不完全直给',
    fix: '让角色回避、反问、说半句',
    example: '「我恨你。」 → 「你吃了吗。」',
  },
  {
    id: 'no-summary-ending',
    name: '结尾不要总结',
    type: '禁用',
    severity: '高',
    rule: '不要用「终于明白 / 从这一刻起 / 从此」收尾',
    fix: '停在一个动作或一句没说完的话上',
    example: '他终于明白自己错了 → 他把灯关了，又打开',
  },
  {
    id: 'sensory-concrete',
    name: '具体感官落地',
    type: '鼓励',
    severity: '低',
    rule: '每 300 字至少一处非视觉感官（气味 / 触感 / 声音 / 味道）',
    fix: '加一个具体的、不可替换的感官细节',
    example: '房间很安静 → 冰箱的压缩机在响，隔一会儿停一次',
  },
  {
    id: 'no-repeat-opening',
    name: '段首别重复',
    type: '警告',
    severity: '低',
    rule: '相邻段落不要用同两个字开头',
    fix: '改主语或直接并段',
    example: '他…… / 他…… → 他把烟摁灭。第三段直接写楼下',
  },
]);

/** 六项诊断：改之前先看清病灶，不做表面词语替换 */
export const SIX_CHECKS = Object.freeze([
  { key: 'replaceable', name: '可替代性', question: '换一组人物、换一部作品，这段还成立吗？成立之处就是最重的 AI 感' },
  { key: 'agency', name: '人物主体性', question: '人物有自己的欲望、判断、盲点、选择吗？还是只在执行剧情' },
  { key: 'value', name: '有效价值', question: '每句话是否提供信息 / 行动 / 人物 / 氛围 / 情绪 / 节奏 / 结构价值' },
  { key: 'change', name: '事件改变', question: '重要事件是否改变了处境、关系、信息、资源、立场或行动方向' },
  { key: 'emotion', name: '情绪可信', question: '情绪有触发原因、矛盾过程和行为后果吗' },
  { key: 'decision', name: '作者决策', question: '是否明确决定保留什么、舍弃什么，而不是把所有可能性都写进去' },
]);

/** 减法 7 项：表层病灶，机器也能数出来 */
export const SUBTRACT = Object.freeze([
  { key: 'cliche', name: '套话', target: '不禁 / 仿佛 / 映入眼帘 / 心中暗道 / 不由得', pass: '全部清除或 ≤1 处' },
  { key: 'adverb', name: '弱化副词', target: '似乎 / 好像 / 大概 / 或许 / 几乎 / 隐约', pass: '≥3 处被精确化或删除' },
  { key: 'inflation', name: '意义膨胀', target: '在某种程度上 / 从某种意义上说 / 可以说', pass: '全部清除' },
  { key: 'platitude', name: '通用套话', target: '关键时刻 / 一切都变了 / 气氛紧张', pass: '全部替换为具体表现' },
  { key: 'essay', name: '论文结构', target: '首先 / 其次 / 最后 / 综上所述', pass: '全部清除，改用叙事顺序' },
  { key: 'triad', name: '排比三连', target: '连续 3 个结构相同的句子', pass: '至少打破 1 段' },
  { key: 'performance', name: '固定表演', target: '愣住 / 空气凝固 / 嘴角勾起', pass: '至少换掉 2 处为具体动作' },
]);

/** 加法 5 项：只做减法会让文字变干净但变冷 */
export const ADD = Object.freeze([
  { key: 'concrete', name: '具体性', pass: '每 300 字至少 1 处非视觉感官' },
  { key: 'irregular', name: '不规则性', pass: '至少 1 处跑题细节 / 自我纠正 / 未说完的话 / 无功能小动作' },
  { key: 'fingerprint', name: '语言指纹', pass: '抽 3 句对话比对人物说话方式，无偏离' },
  { key: 'subtext', name: '潜台词', pass: '≥30% 对话信息不完全直说' },
  { key: 'ending', name: '留白结尾', pass: '末段无「终于明白 / 第一次 / 从此」类总结句' },
]);

/** 给前端展示用的一份快照 */
export function rulebook() {
  return {
    rules: RULES,
    sixChecks: SIX_CHECKS,
    subtract: SUBTRACT,
    add: ADD,
  };
}
