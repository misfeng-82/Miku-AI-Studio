// 提示词模板库：把散落的字符串收成可复用的资产。
// 结构（target + template + 变量）借鉴 YumingScroll 的 promptLibrary，变量用 {花括号} 占位，由 fillTemplate 注入。

export const TARGETS = Object.freeze({
  outline: '大纲',
  script: '剧本',
  characterModel: '角色设定',
  sceneModel: '场景设定',
  imagePrompt: '分镜图',
  videoPrompt: '视频提示词',
});

export const PROMPT_TEMPLATES = Object.freeze([
  {
    id: 'outline-adapt',
    name: '漫剧改编大纲',
    target: 'outline',
    description: '把小说或创意压成集数明确、爽点可查的分集大纲',
    variables: ['题材', '集数', '单集时长', '改编幅度', '素材'],
    template: [
      '你是漫剧编剧。请把素材改编成 {集数} 集、每集约 {单集时长} 分钟的漫剧大纲。',
      '题材：{题材}；改编幅度：{改编幅度}（忠实 / 抽核 / 借壳）。',
      '素材：{素材}',
      '',
      '硬性要求：',
      '1. adaptation 写清保留什么、砍掉什么、合并什么，以及各自的理由；非忠实改编时 cut 不能为空。',
      '2. characters 分 lead / support / functional 三档，lead 1-5 人，并写人物弧线。',
      '3. scenes 只保留主场景，一次性场景必须写复用方案。',
      '4. beats 是全剧爽点，相邻爽点间隔不超过 3 集，第一个 major 不能落在最后一集。',
      '5. episodes 每集三栏齐全：synopsis（梗概）/ hook（开场钩子）/ suspense（结尾悬念）；梗概必须是叙述体，不能出现引号对白。',
      '',
      '只输出 JSON。',
    ].join('\n'),
  },
  {
    id: 'script-episode',
    name: '分集剧本',
    target: 'script',
    description: '把一集大纲写成带动作节拍与台词的剧本',
    variables: ['集号', '目标秒数', '梗概', '人物', '场景'],
    template: [
      '你是漫剧编剧。请写第 {集号} 集的剧本，目标时长 {目标秒数} 秒。',
      '梗概：{梗概}',
      '出场人物：{人物}；可用场景：{场景}',
      '',
      '硬性要求：',
      '1. flow 由动作节拍与台词节拍交替组成，一个节拍不能两者都有、也不能两者都无。',
      '2. 每个场次至少一个动作节拍——纯对白等于广播剧。',
      '3. 单句台词不超过 22 字；动作描述是叙述体，不能出现引号对白。',
      '4. 开场三拍之内必须有钩子，并在 hookBeat 标出 [场, 拍]。',
      '5. 结尾留悬念，写进 cliff。',
      '',
      '只输出 JSON。',
    ].join('\n'),
  },
  {
    id: 'character-turnaround',
    name: '角色三视图',
    target: 'characterModel',
    description: '建立可复用的角色身份与外观基准',
    variables: ['角色名', '年龄', '性别', '身份', '剧情定位', '画风'],
    template: [
      '同一角色的正面、侧面和背面设定图，纯色中性背景。',
      '角色信息：{角色名}，{年龄}，{性别}，{身份}，{剧情定位}。',
      '身份特征：脸型、眼型、发型、体型、肤色，以及左右位置明确的固定识别点（疤痕、痣、发饰）。',
      '服装与配饰：款式、材质、颜色、穿戴位置。',
      '风格：{画风}。',
      '一致性：三个视角必须保持年龄、比例、服装结构和识别特征一致。',
      '排除项：无关人物、文字、水印、logo、重复肢体和结构畸变。',
    ].join('\n'),
  },
  {
    id: 'scene-model',
    name: '场景模型图',
    target: 'sceneModel',
    description: '无人场景设定图，为后续人物落位保留空间锚点',
    variables: ['场景名', '空间', '固定物件', '光线与材质', '画风'],
    template: [
      '无人场景设定图：{场景名}。',
      '空间：{空间}（入口、出口、纵深、主体区域和镜头可用方向）。',
      '固定物件：{固定物件}及其相对位置。',
      '光线与材质：{光线与材质}（主光方向、时间、表面材质和氛围）。',
      '风格：{画风}。',
      '一致性：后续镜头保持空间布局、物件位置和光线方向稳定，并为人物落位留出清晰的地面与空白区域。',
      '排除项：人物、无关道具、文字、水印、logo。',
    ].join('\n'),
  },
  {
    id: 'image-prompt-frame',
    name: '片段构图参考图',
    target: 'imagePrompt',
    description: '每个视频段落的构图参考图',
    variables: ['段号', '剧情时刻', '出镜角色', '场景', '镜头', '画风与光线'],
    template: [
      '当前第 {段号} 段构图参考图。',
      '剧情时刻：{剧情时刻}（该片段的唯一核心画面）。',
      '出镜角色：{出镜角色}（动作、表情、视线）。',
      '场景：{场景}及固定物件。',
      '镜头：{镜头}（景别、机位、主体位置、前中后景关系）。',
      '风格与光线：{画风与光线}。',
      '连续性：承接上一段末帧，并为下一段保留自然衔接状态。',
      '排除项：后续剧情、未连接角色、身份漂移、文字、水印、logo。',
    ].join('\n'),
  },
  {
    id: 'video-continuity',
    name: '视频连续性约束',
    target: 'videoPrompt',
    description: '跨镜头一致性最强的四段式约束',
    variables: ['当前分镜', '角色参考', '场景参考', '构图参考'],
    template: [
      '当前片段唯一剧情：{当前分镜}。',
      '角色参考只用于锁定身份、外貌、服装和体型。',
      '场景参考只用于锁定空间、物件、材质和光线方向。',
      '构图参考只用于锁定当前片段的画风、机位和主体关系。',
      '按当前分镜的时间顺序完成动作和台词，不提前生成下一段剧情。',
      '开头承接上一段末帧的位置、姿态、视线、光线和镜头运动。',
      '结尾停留在可自然连接下一段的有效画面，不默认黑屏、闪白或眨眼转场。',
    ].join('\n'),
  },
  {
    id: 'script-rewrite',
    name: '剧本优化改写',
    target: 'script',
    description: '在不动故事主旨的前提下提升结构与张力',
    variables: ['原剧本', '问题清单'],
    template: [
      '你是一位顶级剧本编剧顾问，擅长提升剧本的结构、情感和戏剧张力。',
      '请对下方剧本进行系统性改写，重点解决这些问题：{问题清单}',
      '',
      '改写纪律：',
      '1. 保留核心故事线和主要人物设定，不改变故事主旨。',
      '2. 优化情节结构，事件发展要有清晰的因果关系，逻辑严密。',
      '3. 丰富人物对话，使其更具个性、情感色彩和真实感，避免生硬或刻板。',
      '4. 强化戏剧冲突，突出人物之间的矛盾与情感张力。',
      '5. 优化整体节奏，合理分配高潮与缓和段落，避免拖沓或推进过快。',
      '6. 保持或适度增加内容长度，确保充实但不过度冗长。',
      '',
      '原剧本：{原剧本}',
    ].join('\n'),
  },
]);

/** 描述维度词典：强制模型把关键特征写全，避免"长得好看"这类空话。 */
export const DESCRIPTION_DIMENSIONS = Object.freeze([
  { id: 'identity-marks', name: '身份识别点', items: ['稳定的面部标记', '左右位置明确的疤痕或痣', '固定妆容', '不可漂移的核心特征'] },
  { id: 'hair-identity', name: '发型识别', items: ['长度和分缝', '刘海轮廓', '发色和挑染位置', '固定发饰及佩戴方向'] },
  { id: 'body-scale', name: '体型与比例', items: ['身高与头身比', '肩宽与体态', '年龄感', '与其他角色的身高差'] },
  { id: 'wardrobe', name: '服装结构', items: ['款式与版型', '主色与辅色', '材质与垂坠', '固定配饰及佩戴位置'] },
  { id: 'rendering', name: '绘制与材质', items: ['线条特征', '明暗塑造', '表面材质', '颗粒或笔触强度'] },
]);

export function getTemplate(id) {
  return PROMPT_TEMPLATES.find((t) => t.id === id);
}

/** 用变量表填充模板；未提供的变量保留占位符，方便人眼发现漏填。 */
export function fillTemplate(id, vars = {}) {
  const t = getTemplate(id);
  if (!t) return '';
  let out = t.template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? '');
  }
  return out;
}

export function listTemplates(target) {
  return target ? PROMPT_TEMPLATES.filter((t) => t.target === target) : PROMPT_TEMPLATES;
}
