import { stylePromptSuffix, styleGuardrail, getStyle } from '../assets/stylePresets.js';
import { fillTemplate } from '../assets/promptLibrary.js';

// 资产中心：角色设定与场景设定。
// 一致性方案取自三个参考项目的共识——
//   YumingScroll：consistencyPrompt 是一等公民，必须写全身份维度
//   generate-comic-drama-video：场景图必须无人，且禁止 scene N→N+1 串联
//   manga-studio：参考图顺序固定（场景在前、角色在后），脸/发/服装严格复制

const IDENTITY_DIMENSIONS = [
  '性别与年龄段', '脸型与五官比例', '发型（长度、分缝、刘海、发色、发饰及佩戴方向）',
  '体型与头身比', '服装（款式、主辅色、材质、固定配饰）', '气质与表演倾向',
  '固定识别点（疤痕、痣、固定妆容，须标明左右位置）',
];

/** 生成角色一致性提示词：写不全这些维度，换镜头就会换脸 */
export function buildConsistencyPrompt(char, { styleId } = {}) {
  const parts = [
    `角色：${char.name}`,
    char.role ? `剧情定位：${char.role}` : null,
    char.persona?.gender || char.persona?.ageRange ? `性别年龄：${[char.persona?.gender, char.persona?.ageRange].filter(Boolean).join('，')}` : null,
    char.persona?.appearance ? `外貌：${char.persona.appearance}` : null,
    char.persona?.personality?.length ? `性格：${char.persona.personality.join('、')}` : null,
    char.persona?.motivation ? `动机：${char.persona.motivation}` : null,
    char.arc ? `人物弧线：${char.arc}` : null,
  ].filter(Boolean);

  const body = [
    parts.join('；'),
    '',
    '以下维度为跨镜头锁定项，任何一镜都不得漂移：',
    ...IDENTITY_DIMENSIONS.map((d) => `- ${d}`),
  ].join('\n');

  return {
    id: char.id,
    name: char.name,
    importance: char.importance ?? char.tier ?? 'supporting',
    consistencyPrompt: body,
    // 三视图：正面/侧面/背面共用一套锁定项
    sheetPrompt: fillTemplate('character-turnaround', {
      '角色名': char.name,
      '年龄': char.persona?.ageRange ?? '未设定',
      '性别': char.persona?.gender ?? '未设定',
      '身份': char.role ?? '未设定',
      '剧情定位': char.tier === 'lead' ? '主角' : (char.tier === 'support' ? '重要配角' : '功能性角色'),
      '画风': getStyle(styleId).prompt,
    }),
    imagePrompt: char.image?.prompt ?? '',
    negativePrompt: char.image?.negativePrompt ?? getStyle(styleId).negative,
    voicePrompt: char.voice?.prompt ?? '',
    // 造型变体：换装不换脸
    variants: buildVariants(char),
  };
}

function buildVariants(char) {
  // 剧本里出现的状态变化（受伤、换装、时间跨度）才新建变体，日常不新建
  const cues = [];
  const text = `${char.arc ?? ''}${char.persona?.appearance ?? ''}`;
  if (/伤|血|绷带/.test(text)) cues.push({ name: '负伤状态', changeReason: '剧情中有受伤描写' });
  if (/婚|礼服|盛装/.test(text)) cues.push({ name: '盛装状态', changeReason: '剧情中有礼仪场合' });
  if (/幼|少|少年|童年/.test(text)) cues.push({ name: '少年时期', changeReason: '剧情跨年龄' });
  return cues.length ? cues : [{ name: '常态', changeReason: 'default' }];
}

/** 场景设定图提示词：强制无人，为后续人物落位保留空间锚点 */
export function buildScenePrompt(scene, { styleId, outline } = {}) {
  const anchors = (scene.anchors ?? []).map((a) => a.name ?? a).slice(0, 5);
  const usage = (outline?.episodes ?? []).filter((e) => (e.sceneIds ?? []).includes(scene.id)).map((e) => e.ep);

  return {
    id: scene.id,
    name: scene.name,
    primary: !!scene.primary,
    usedInEpisodes: usage,
    reusePlan: scene.reusePlan ?? '',
    anchors,
    modelPrompt: fillTemplate('scene-model', {
      '场景名': scene.name,
      '空间': scene.summary ?? '待补充空间结构（入口、出口、纵深、镜头可用方向）',
      '固定物件': anchors.join('、') || '待补充关键道具',
      '光线与材质': (scene.lighting ?? []).map((l) => l.state).join('、') || '主光方向待定',
      '画风': getStyle(styleId).prompt,
    }),
    imagePrompt: scene.image?.prompt ?? '',
    negativePrompt: [getStyle(styleId).negative, '人物，人影，背影，脸，手，身体，人群，剪影，任何类人形体'].join(', '),
    // 场景图里出现人是漫剧最常见的事故：会把人生成进背景，之后人物再落位就重影
    noPeopleGuard: '禁止出现人物、角色、人影、背影、脸、手、身体、乘客、人群、剪影或任何类人形体；即使原描述含人物动作，也只提取空间与道具。',
  };
}

/** 参考图策略：固定锚点，禁止串联 */
export const REFERENCE_POLICY = Object.freeze({
  order: ['场景模型图', '角色设定图（按出场顺序）', '关键道具图'],
  rules: [
    '所有镜头都回到同一组已确认的锚点图取参考，禁止用第 N 镜的产出当第 N+1 镜的参考',
    '串联会累积漂移：每一镜的偏差会叠加到下一镜，十镜之后人物就换了张脸',
    '角色参考只用于锁定身份、外貌、服装与体型；场景参考只用于锁定空间、物件、材质与光线方向',
    '未确认的候选图不得进入参考链',
  ],
});

export function buildAssets(outline, script, { styleId = 'jp-anime' } = {}) {
  const characters = (outline?.characters ?? []).map((c) => buildConsistencyPrompt(c, { styleId }));
  const scenes = (outline?.scenes ?? []).map((s) => buildScenePrompt(s, { styleId, outline }));
  const props = (outline?.props ?? []).map((p) => ({
    id: p.id, name: p.name, function: p.function,
    negativePrompt: [getStyle(styleId).negative, '人物，手，手指'].join(', '),
    sheetNote: '道具图须使用纯白底、无人物、无手，便于后续合成时抠图与缩放',
  }));

  return {
    styleId,
    styleSuffix: stylePromptSuffix(styleId),
    styleGuardrail: styleGuardrail(styleId),
    characters,
    scenes,
    props,
    referencePolicy: REFERENCE_POLICY,
    // 出场统计：谁在哪些集出现，便于确认资产是否真的被用到
    usage: buildUsage(script, outline),
  };
}

function buildUsage(script, outline) {
  const byChar = new Map();
  const byScene = new Map();
  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      for (const c of sc.characters ?? []) {
        if (!byChar.has(c)) byChar.set(c, new Set());
        byChar.get(c).add(ep.ep);
      }
      if (sc.sceneId) {
        if (!byScene.has(sc.sceneId)) byScene.set(sc.sceneId, new Set());
        byScene.get(sc.sceneId).add(ep.ep);
      }
    }
  }
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  return {
    characters: [...byChar.entries()].map(([id, eps]) => ({ id, name: names.get(id) ?? id, episodes: [...eps].sort((a, b) => a - b) })),
    scenes: [...byScene.entries()].map(([id, eps]) => ({ id, episodes: [...eps].sort((a, b) => a - b) })),
    // 大纲里有、剧本里没用到的：多半是废弃资产
    unused: (outline?.characters ?? []).filter((c) => !byChar.has(c.id)).map((c) => c.id),
  };
}
