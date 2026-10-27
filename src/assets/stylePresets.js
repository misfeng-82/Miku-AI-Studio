// 画风预设：中文提示词（给国内模型）+ 英文提示词（给出图模型）+ 反向提示词，三者必须成对存在。
// 上游 manga-studio 的坑：UI 有 15 个风格选项但 VISUAL_STYLE_PROMPTS 只有 6 个 key，
// 缺失的风格会退化成把 id 字符串当风格词喂给模型。这里用同一份数组同时驱动 UI 与取词，杜绝错位。

export const STYLE_PRESETS = Object.freeze([
  {
    id: 'jp-anime', label: '日式动漫', group: '二次元',
    prompt: '日式动漫风格，赛璐璐上色，干净线稿，色彩鲜明，人物比例成熟，电影感光影',
    en: 'Japanese anime style, cel-shaded, vibrant colors, expressive eyes, clean line art, Studio Ghibli / Makoto Shinkai quality',
    negative: 'photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions',
  },
  {
    id: 'cn-guoman', label: '国漫风', group: '二次元',
    prompt: '半写实国漫风，成熟人物比例，强黑色线稿，漫画分层阴影，纸感颗粒，暗部压深',
    en: 'Chinese donghua style, semi-realistic proportions, strong ink outlines, layered comic shading, paper grain, deep shadows',
    negative: 'photorealistic, chibi, deformed hands, blurry, watermark, text, logo, low quality, inconsistent style',
  },
  {
    id: 'kr-webtoon', label: '韩漫条漫', group: '二次元',
    prompt: '韩式条漫风格，柔和渐变，精致五官，电影感布光，高饱和配色',
    en: 'Korean webtoon style, soft gradients, refined features, cinematic lighting, high saturation',
    negative: 'photorealistic, rough sketch, deformed anatomy, blurry, watermark, text, logo',
  },
  {
    id: 'us-comic', label: '美漫', group: '二次元',
    prompt: '美漫风格，粗轮廓线，重墨块，网点质感，硬朗阴影，高对比配色',
    en: 'American comic style, bold outlines, heavy inking, halftone texture, hard shadows, high contrast palette',
    negative: 'photorealistic, anime, soft pastel, blurry, watermark, text, logo',
  },
  {
    id: 'ink-wash', label: '水墨国风', group: '国风',
    prompt: '水墨国风，晕染笔触，留白构图，淡彩设色，古典意境',
    en: 'Chinese ink wash painting style, wet-on-wet brushwork, negative space composition, muted mineral colors',
    negative: 'neon, cyberpunk, photorealistic, heavy outlines, blurry, watermark, text, logo',
  },
  {
    id: 'gongbi', label: '工笔重彩', group: '国风',
    prompt: '工笔重彩，细腻勾线，层层渲染，矿物色，富丽堂皇',
    en: 'traditional Chinese gongbi style, fine outlining, layered washes, mineral pigments, ornate',
    negative: 'sketchy, rough, photorealistic, blurry, watermark, text, logo',
  },
  {
    id: 'suspense-guoman', label: '悬疑国漫', group: '悬疑',
    prompt: '半写实国漫悬疑风，成熟人物比例，冷蓝灰低饱和色调，强黑色线稿，纸张颗粒质感，漫画分层阴影，暗部压深，异常线索用少量高亮色',
    en: 'semi-realistic Chinese anime suspense style, cold blue-grey desaturated palette, strong black linework, paper grain, layered comic shading, single accent color for clues',
    negative: 'bright pastel, cute chibi, photorealistic, blurry, watermark, text, logo',
  },
  {
    id: 'noir-manga', label: '黑白硬线漫画', group: '悬疑',
    prompt: '高反差黑白漫画，硬朗轮廓线，大面积黑影切割，网点和排线质感，镜头压迫感强，局部只允许极少强调色',
    en: 'high-contrast black and white manga, hard contour lines, large black shadow cuts, screentone and hatching texture, oppressive framing',
    negative: 'colorful, pastel, photorealistic, blurry, watermark, text, logo',
  },
  {
    id: 'urban-anime', label: '都市动画', group: '都市',
    prompt: '现代都市动画风，清晰色块，干净线稿，夜景霓虹反射，人物表情明确但不过度幼态',
    en: 'modern urban anime style, clean color blocks, crisp linework, neon night reflections, mature expressive faces',
    negative: 'chibi, photorealistic, rough sketch, blurry, watermark, text, logo',
  },
  {
    id: 'watercolor', label: '水彩绘本', group: '绘本',
    prompt: '水彩绘本风格，柔和晕染，通透色层，纸纹质感，温润手绘感',
    en: 'watercolor picture book style, soft washes, translucent layers, visible paper texture, gentle hand-drawn feel',
    negative: 'heavy ink, high contrast, photorealistic, blurry, watermark, text, logo',
  },
  {
    id: 'thick-paint', label: '厚涂插画', group: '绘本',
    prompt: '厚涂插画风格，厚重笔触，丰富质感，戏剧性布光，强烈体积感',
    en: 'thick painted illustration, rich brushwork, dramatic lighting, strong volume',
    negative: 'flat cel shading, sketch, photorealistic, blurry, watermark, text, logo',
  },
  {
    id: 'minimal-line', label: '极简线稿', group: '绘本',
    prompt: '极简线稿漫画，少色块，画面干净，空间留白明确，用构图和人物姿态推动叙事',
    en: 'minimal line-art comic, few color blocks, clean composition, deliberate negative space',
    negative: 'busy background, heavy shading, photorealistic, blurry, watermark, text, logo',
  },
]);

const BY_ID = new Map(STYLE_PRESETS.map((s) => [s.id, s]));
export const DEFAULT_STYLE_ID = 'jp-anime';

export function getStyle(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_STYLE_ID);
}

/** 注入正文：所有人物/场景提示词都必须带上，保证全片画风一致。 */
export function stylePromptSuffix(id) {
  const p = getStyle(id);
  return `所选画风：${p.label}。视觉提示词：${p.prompt}同一项目内所有人物、场景、图片和视频提示词必须保持该画风一致，不得切换到其他画风。`;
}

/** 注入护栏：反向约束，防止换脸与画风漂移。 */
export function styleGuardrail(id) {
  const p = getStyle(id);
  return `不要偏离「${p.label}」画风，不要让角色频繁换脸，不要血腥，不要低质量畸变，不要可读水印或 logo。${p.negative}`;
}

export function styleGroups() {
  const g = new Map();
  for (const s of STYLE_PRESETS) {
    if (!g.has(s.group)) g.set(s.group, []);
    g.get(s.group).push({ id: s.id, label: s.label });
  }
  return [...g.entries()].map(([group, items]) => ({ group, items }));
}
