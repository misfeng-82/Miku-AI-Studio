/* 主体资产图的生成提示词（前端唯一来源）
 *
 * 为什么要重写：
 *   旧版每个资产只有一句「Character reference sheet of xxx」，模型只能自由发挥，
 *   出来的图脸和服装每张都不一样，接进分镜当参考图就废了。
 *   新版按「一张图锁死一个资产」来写版面，人、景、物各有自己的排版规则：
 *     角色 = 左 34% 面部基准 + 右侧正/侧/背三视图 + 细节条（同一张脸、同一套造型）
 *     场景 = 主建立视图 + 右栏细节 + 底行细节，绝对无人物（空景资产）
 *     道具 = 正面/侧面/背面/细节四视图，纯白底，只写物理外观
 *
 * 语言：一律英文。
 *   实测本项目用的 gpt-image 系列对中文长句的安全审核极敏感，一整段中文会被整条拦掉；
 *   英文结构化描述能稳定通过，且对版面（比例、分栏、留白）的控制更准。
 */

/** 风格名 → 英文画风串。
 *  与 docs/style-skills/01–08 风格卡同源（真人 8 种）：每条都写清光位 / 色彩 / 质感 / 镜头，避免模型自由发挥；
 *  真人的一律显式排除 anime / illustration / 3d render，这是「仿真人剧不出 2D 动漫」的硬保险。 */
const STYLE_EN = {
  电影写实: 'cinematic photorealistic live-action film still, hard single key light from 45 degrees one side, clean shadow terminator, teal-orange separation, 35mm shallow depth of field, fine film grain, real skin texture, not anime, not illustration, not 3d render',
  都市剧写实: 'modern Chinese metropolitan TV drama official still, photorealistic live-action, large window key light with soft fill at 1:2, neutral slightly cool white balance, full-frame digital sharpness, real human actor, not anime',
  纪实跟拍: 'documentary photojournalistic candid realism, available light only, no fill, uneven honest shadows, mixed color temperature, high-ISO grain, slight motion blur, 24mm handheld off-center frame, photorealistic, not anime',
  胶片质感: '35mm film photography still, expired Kodak look, raking warm sunlight, golden rim on hair, halation around highlights, coarse negative grain, gentle vignette, faded warm grade, photorealistic live-action, not anime',
  国剧质感: 'prestige Chinese period drama character poster, photorealistic, soft large top light, twin rim lights on hairline and shoulders, warm clean skin, silk and linen fabric texture, low-saturation Chinese interior, not anime',
  港风写实: 'Hong Kong 90s cinema noir realism, practical neon signage as key light, hard side light, half-lit face with hard shadow edge, teal-green shadows against magenta highlights, wet ground bouncing neon, film grain and halation, photorealistic live-action, not anime',
  韩剧质感: 'Korean drama official poster, photorealistic live-action, huge frontal soft source at 1:1.5, near-shadowless, creamy white and pale pink palette, luminous translucent skin not oily, 85mm f1.4 creamy bokeh, not anime',
  短剧写实: 'vertical short-drama poster realism, photorealistic live-action, hard rim light from 30 degrees behind-side, subject popping from dark background, high contrast, cool teal-blue shadows, crisp HDR look, premium costume fabric, not anime',
};

/** 动画 4 种（对应风格卡 09–12）：不写「真实毛孔 / 胶片颗粒」这类写实词，避免两套指令打架 */
const ANIME_EN = {
  动漫电影: 'Japanese anime feature film, 2d hand-drawn cel-shaded, clean inked lineart with weight variation, flat color blocks, same-hue one-step-deeper shadow blocks, strong backlight on hair, volumetric light beams, watercolor anime background, not photorealistic',
  '3D 国漫': 'Chinese 3d animation feature frame, offline-render cgi quality, subsurface-scattering translucent skin, volumetric light through haze, desaturated premium grey palette, strand-grouped hair, pbr fabric and anisotropic metal, not 2d, not live-action',
  吉卜力动画: 'Studio Ghibli style 2d hand-drawn animation, watercolor-paper background with visible brush strokes, rounded flat-color characters with soft thin ink outlines, warm natural daylight, dappled shadows in warm grey green, not 3d, not photorealistic',
  赛博朋克: 'cyberpunk cinematic frame, magenta and cyan neon cross-lighting, practical signage key light, mirror-wet ground reflections, volumetric haze and fine rain with light shafts, techwear pvc metal holographic materials, 24mm low angle slight fisheye, not bright sunlight',
  国漫3D新风格: 'stylized 3d cgi of Chinese animation, oriental composition, volumetric light, clean materials, not 2d',
  赛璐璐手绘: 'cel-shaded 2d animation, flat color blocks, clean lineart',
};

export function styleEn(styleName) {
  const s = String(styleName ?? '').trim();
  if (!s) return STYLE_EN['电影写实'];
  if (STYLE_EN[s]) return STYLE_EN[s];
  if (ANIME_EN[s]) return ANIME_EN[s];
  if (/动漫|漫画|二次元|吉卜力|赛璐璐|国漫|3D 卡通/i.test(s)) return 'anime cel-shaded illustration, clean lineart, 2d';
  if (/3D|三维/i.test(s)) return 'stylized 3d cgi animation, clean materials, cinematic lighting';
  return STYLE_EN['电影写实'];
}

export const isRealStyle = (styleName) => {
  const s = String(styleName ?? '').trim();
  if (!s) return true;
  if (STYLE_EN[s]) return true;
  if (ANIME_EN[s]) return false;
  return !/动漫|漫画|二次元|吉卜力|赛璐璐|国漫|3D 卡通/i.test(s);
};

/** 把中文描述压成一句可进英文提示词的短语（保留人名与外形关键词，去掉标点） */
function clip(text, n = 90) {
  return String(text ?? '').replace(/\s+/g, ' ').replace(/[「」【】（）()]/g, ' ').trim().slice(0, n);
}

function charSheet(o, style, tpl) {
  const s = styleEn(style);
  const real = isRealStyle(style);
  const subject = `${o.name}${o.role ? ` (${o.role})` : ''}`;
  const look = clip([o.appearance, o.styling, o.desc].filter(Boolean).join('; '), 120);
  const layout = /单特写/.test(tpl)
    ? 'ONE single chest-up front close-up of this character, centered, shoulders complete, generous margin on both sides, feet-to-head height not required'
    : /全身/.test(tpl)
      ? 'ONE full-body standing portrait, natural relaxed pose, arms hanging naturally, entire figure inside frame with head and feet fully visible'
      : [
        'ONE 16:9 character reference sheet, split into two columns inside a single image, no outer frame.',
        'LEFT COLUMN, about 34% of the width: one chest-up front close-up of the face — this is the ONLY facial benchmark for the whole project; shoulders complete, both sides breathing space, bottom edge cut straight and level.',
        'RIGHT COLUMN, upper half: front / left-side / back full-body turnaround of the SAME person at the SAME moment in the SAME outfit, three figures side by side at equal height, natural standing, calm neutral expression, arms hanging naturally, not holding anything.',
        'RIGHT COLUMN, lower half: four to five small detail crops — collar, cuff, waistline, accessory, fabric texture — close-up only, no full figure.',
      ].join(' ');
  return [
    `Character reference sheet for an AI short drama. This is the only asset image of ${subject}; every later shot must reuse this exact face and this exact styling.`,
    `SUBJECT: ${subject}.${look ? ` Appearance and styling: ${look}.` : ''}`,
    real
      ? 'Photorealistic real human being with natural skin texture, real pores, real hair strands, no beauty-filter smoothing, no plastic skin.'
      : 'Consistent stylized character design, clean shapes, no photorealistic skin.',
    layout,
    'CONSISTENCY IS THE ONLY PRIORITY: left close-up and right turnaround must be the same person — same face, same hairstyle, same outfit, same makeup. Do not draw a second outfit, do not draw a second person, do not make an emotion collage.',
    'BACKGROUND AND LIGHT: plain pure white background, no environment, no props, no floor line. Left column: soft directional key light with ambient occlusion. Right column: flat even lighting.',
    'PROPORTIONS ARE CRITICAL: the three turnaround figures must be exactly the same height; no stretching, no squashing, no perspective foreshortening. If space runs short, shrink the detail strip, never the figures.',
    'FORBIDDEN: any text, labels, arrows, dimension lines, borders, decorative dividers, watermark or logo; extra hands or fingers; nine-head proportions; "8K, masterpiece, ultra detailed" style filler words; a separate costume sheet; a grid of facial expressions.',
    `STYLE: ${s}.`,
  ].join('\n');
}

function sceneSheet(o, style) {
  const s = styleEn(style);
  const name = o.name || o.location || 'Location';
  const time = o.time ? ` / ${o.time}` : '';
  const place = clip(o.desc || o.prompt || o.summary, 140);
  const light = clip(o.lighting, 60);
  const anchors = Array.isArray(o.anchors)
    ? o.anchors.map((x) => (typeof x === 'string' ? x : [x.name, x.desc].filter(Boolean).join(' — '))).join('; ')
    : clip(o.anchors, 80);
  const worn = /(废弃|废墟|破旧|老旧|村|巷|工地|旧船|旧屋|民国)/.test(`${name} ${place}`);
  const surface = worn
    ? 'Weathered, lived-in materials: chipped paint, water stains, patina on metal, worn wood grain, dust in corners and light shafts; nothing looks factory-new.'
    : 'Well-kept, actively maintained materials: even sheen on surfaces, swept ground, polished fittings, tight joinery, no peeling paint, no water staining; wear only where traffic really happens.';
  return [
    'Empty environment reference sheet for an AI short drama. This is the only asset image of this location; every later shot must reuse this exact space and this exact lighting state.',
    `LOCATION: ${name}${time}.${place ? ` ${place}.` : ''}`,
    light ? `LIGHTING STATE: ${light}.` : '',
    anchors ? `SPACE ANCHORS: ${anchors}.` : '',
    'LAYOUT: one 16:9 landscape canvas, panels separated by thin hairline rules.',
    'MAIN ZONE: top-left, about 72% of the canvas width and 70% of its height — the master establishing view of this location, one single canonical look, one single lighting state.',
    'RIGHT COLUMN: full height along the right edge, two stacked detail panels — close crops of the most recognizable space anchors and key materials.',
    'BOTTOM ROW: three detail panels beneath the main zone — floor, threshold, surface wear, joinery, practical lights, all from the SAME space and SAME lighting state.',
    'THE SPACE MUST BE IDENTICAL ACROSS ALL PANELS: same architecture, same furniture placement, same materials, same wear marks, same time and weather. Do not change the room between panels, do not add a second location.',
    'ABSOLUTELY NO PEOPLE ANYWHERE: no human figures, no characters, no crowds, no silhouettes, no hands, no body parts, no reflections of people. This is a pure empty environment asset.',
    'NO TEXT, labels, arrows, dimension lines, borders, decorative frames or watermark. Do not draw a collage poster. Do not invent props that are not described.',
    'PERSPECTIVE MUST BE STABLE: no warped perspective, no melted geometry, no floating objects, no fisheye distortion.',
    surface,
    `STYLE: ${s}.`,
    'NEGATIVE: people, human figures, crowds, silhouettes of people, hands, fingers, oversaturated colours, showroom sterility, warped perspective, melted geometry, floating objects, text, watermark, signature.',
  ].filter(Boolean).join('\n');
}

function propSheet(o, style) {
  const name = o.name || 'Object';
  const type = o.type ? ` (${o.type})` : '';
  const desc = clip(o.desc || o.description, 120);
  return [
    'Photorealistic prop design sheet for an AI short drama. This is the only asset image of this object; later shots and close-ups must show the same object.',
    `OBJECT: ${name}${type}.${desc ? ` Physical appearance: ${desc}.` : ''}`,
    'LAYOUT: front / side / back / key-detail views side by side on one canvas, same object, same scale, same material state.',
    'BACKGROUND AND LIGHT: plain pure white background, even soft studio light, slight contact shadow, material, colour, size and wear clearly readable.',
    'FORBIDDEN: a hand holding it, any scene environment, text labels, arrows, dimension lines, watermark; do not draw it as a different object; do not change its shape between views.',
    `STYLE: ${styleEn(style)}.`,
  ].filter(Boolean).join('\n');
}

/**
 * 单张资产图的生成提示词。
 * @param {string} kind  cast | scene | prop
 * @param {object} c     条目（{name, desc, role, lighting, anchors}）
 * @param {object} v     版本（{name, desc}）
 * @param {object} opt   { style:'电影写实', template:'单特写+三视图' }
 */
export function assetSheetPrompt(kind, c, v, { style = '电影写实', template = '单特写+三视图' } = {}) {
  const o = {
    name: c?.name ?? '',
    role: c?.role ?? '',
    type: c?.type ?? '',
    desc: v?.desc || c?.desc || '',
    appearance: c?.appearance ?? '',
    styling: c?.styling ?? '',
    time: c?.time ?? '',
    lighting: c?.lighting ?? '',
    anchors: c?.anchors ?? c?.desc ?? '',
    summary: c?.summary ?? '',
  };
  if (kind === 'scene') return sceneSheet(o, style);
  if (kind === 'prop') return propSheet(o, style);
  return charSheet(o, style, template);
}

/** 资产提示词的中文摘要（给页面折叠区显示，不发给模型） */
export function assetSheetZh(kind, c, v) {
  const name = c?.name ?? '';
  const desc = clip(v?.desc || c?.desc, 60);
  if (kind === 'scene') {
    return `${name}：空景资产图，主建立视图 + 右栏两格细节 + 底行三格细节，全部同一空间同一光位，画面里绝对不能有人。${desc ? ` 场景要点：${desc}` : ''}`;
  }
  if (kind === 'prop') {
    return `${name}：道具设定图，正/侧/背/细节四视图，纯白底，只表现材质、颜色、形状、磨损。${desc ? ` 外观：${desc}` : ''}`;
  }
  return `${name}：角色参考板，左 34% 面部特写作为唯一面部基准，右上是同造型正/侧/背三视图，右下是领口/袖口/腰线/配饰等细节条。一张图锁死脸和造型。${desc ? ` 造型：${desc}` : ''}`;
}
