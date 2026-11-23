/* 视图域：漫剧工作台（照 DramaBuddy 的四段结构搬）
 *
 * 顶部四个模块，顺序与文案按原产品：
 *   剧本设定（N集剧本） → 风格设置（无风格／已选风格） → 主体资产（N项） → 分集管理（N项）
 *
 *   ① 剧本设定：上传剧本文件 / 手动输入粘贴 / 导入现有剧本项目 —— 三种入口，右侧是剧本格式说明；
 *      解析后左栏是集列表（共 N 集 / 第 N 集），右栏是选中集正文，底部一个「完成」。
 *   ② 风格设置：绘图模型 / 绘图模板（角色·场景·道具 三行）/ 绘图风格（预设｜自定义 + 分类网格）/ 右侧预览。
 *   ③ 主体资产：角色·场景·道具 三个 Tab；「智能提取角色」「生成全部初始版图片」「生成全部图片」「角色库」「新增角色」；
 *      每个角色挂多个版本（初始版、第 11 集换装…），右上「展示多版本」开关。
 *   ④ 分集管理：匹配全部主体｜生成全部分镜｜生成全部视频｜下载全部视频｜合成全部视频｜新建分集；
 *      分集卡片带「主体 / 分镜 / 视频」三个进度点，状态四档（未进行 / 进行中 / 失败 / 完成）。
 *
 * 这里接的是 Miku 自己的引擎：解析走 parseScriptText，分镜走 /api/shots/split，
 * 视频走画布子服务的 ComfyUI 工作流（/canvas/api/generate）。
 */
import {
  state, api, esc, ICONS, toast, pageHead, busyBtn,
  download, save, render,
} from '../core.js';
import { parseScriptText, toNumber } from '../parseScriptText.js';
import { assetSheetPrompt, assetSheetZh, isRealStyle } from './drama-asset-prompt.js?v=20261122c';

const KEY = 'miku-comic-v1';

function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
}
function persist(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 配额满了不挡流程 */ }
}

const DEFAULTS = () => ({
  tab: 'script',
  raw: '',
  script: null,
  outline: null,       // 大纲：角色/场景/道具的权威来源（比从正文用正则捞可靠）
  stats: null,
  selEp: 0,
  cast: [],
  scenes: [],
  props: [],
  style: { model: 'gpt-image-2.5-flare', role: '单特写+三视图', scene: '不使用', prop: '不使用', preset: '电影写实', custom: '', imgModel: '' },
  works: [],
  openWork: null,     // 分集详情：正在看哪一集
  openSeg: null,      // 分镜详情：正在看哪一段（E01-G01）
  prompts: {},        // 段级提示词覆盖：{ segId: '改过的提示词' }
  assetTab: 'cast',   // 主体资产当前看的分类：cast / scene / prop
  assetEdit: null,    // 正在改提示词的那张资产：'cast:0:0'
  engine: null,       // 画布两路（图片 / 视频）实探结果
  flow: null,
  idea: '',           // 一句话成剧：设定
  genre: '逆袭',      // 一句话成剧：题材
  epCount: 10,        // 一句话成剧：总集数
});

const SLOT = () => {
  if (!state.data.comic) state.data.comic = { ...DEFAULTS(), ...(restore() || {}) };
  const d = state.data.comic;
  for (const k of Object.keys(DEFAULTS())) if (d[k] === undefined) d[k] = DEFAULTS()[k];
  // 旧数据迁移：早先只存扁平 w.videos，现在按段分包成 w.takes
  for (const w of d.works ?? []) {
    if (!w.takes && Array.isArray(w.videos) && w.videos.length) {
      w.takes = {};
      for (const v of w.videos) if (v.url && v.segId) w.takes[v.segId] = [{ url: v.url, ver: 1, at: v.at ?? Date.now() }];
    }
  }
  // 旧数据清洗：曾有两个轮询同时接管同一 taskId，同版本被写了两条，按版本号去重（保留已完成那条）
  for (const w of d.works ?? []) {
    for (const [k, arr] of Object.entries(w.takes ?? {})) {
      if (!Array.isArray(arr) || arr.length < 2) continue;
      const seen = new Map();
      for (const t of arr) {
        const key = t.ver ?? 0;
        const prev = seen.get(key);
        if (!prev || (prev.pending && !t.pending)) seen.set(key, t);
      }
      w.takes[k] = [...seen.values()].sort((a, b) => (a.ver ?? 0) - (b.ver ?? 0));
    }
  }
  // 场景 / 道具早先只有 { name, desc }，没有版本数组：补成和角色一样的结构，
  // 否则它们点不进去、也出不了图
  for (const kind of ['scenes', 'props']) {
    for (const it of d[kind] ?? []) {
      if (!Array.isArray(it.versions) || !it.versions.length) {
        it.versions = [{ name: '初始版', desc: it.desc ?? '' }];
      }
    }
  }
  // 旧数据一次性迁移：原来默认/常选的是「动漫电影」，仿真人剧要的是写实
  if (!d.style?.presetMigrated) {
    d.style = d.style ?? {};
    if (!d.style.preset || d.style.preset === '动漫电影') d.style.preset = '电影写实';
    d.style.presetMigrated = true;
  }
  return d;
};

const commit = (d) => { persist(d); save(); render(); };

/* ================= 小工具 ================= */
const tagOf = (ok, txt) => `<span class="tag ${ok ? 'teal' : 'outline'}">${esc(txt)}</span>`;

const STYLE_CATS = ['全部', '真人写实', '通用', '现代言情', '古代言情', '科幻奇幻', '玄幻仙侠', '悬疑灵异', '年代历史', '国风武侠', '动漫电影', '民俗克系', '诡秘克系', '蒸汽民国', '赛博朋克', '中式仙侠', '3D 国漫', '日式奇幻', '古典历史', '韩系漫画', '吉卜力动画', '赛璐璐手绘', '年代都市', '3D 卡通', '黑白漫画', '美式漫画', '青春校园', '昏暗色调', '古风插画', '都市异能', '东方玄幻', '精致 3D CG', '国漫 3D 新风格', '赛博朋克游戏 CG'];
// 前排是「真人剧」五种：仿真人短剧要的是这些，不是动漫。默认就是电影写实。
const STYLE_GRID = ['电影写实', '都市剧写实', '纪实跟拍', '胶片质感', '国剧质感', '港风写实', '韩剧质感', '短剧写实', '动漫电影', '3D 国漫', '吉卜力动画', '赛博朋克'];
/* 风格缩略图：12 个风格都用真图（420×560，放在 public/assets/styles/），同一场景同一人物只换画风，一眼能比出差别。
   下面的 LIVE_FILTER 只在某张样图缺失时兜底，不再作为主展示。 */
const STYLE_SAMPLE = {
  '电影写实': '/assets/styles/cinematic.jpg',
  '都市剧写实': '/assets/styles/urban-tv.jpg',
  '纪实跟拍': '/assets/styles/docu.jpg',
  '胶片质感': '/assets/styles/film-grain.jpg',
  '国剧质感': '/assets/styles/cn-drama.jpg',
  '港风写实': '/assets/styles/hk.jpg',
  '韩剧质感': '/assets/styles/kr.jpg',
  '短剧写实': '/assets/styles/short-drama.jpg',
  '动漫电影': '/assets/styles/anime-film.jpg',
  '3D 国漫': '/assets/styles/3d-cn.jpg',
  '吉卜力动画': '/assets/styles/ghibli.jpg',
  '赛博朋克': '/assets/styles/cyberpunk.jpg',
};
/* 绘图模型：只列 AutoDL 图片通道（/api/v1/models）里真实存在的图像型号，2026-11-22 实测拉到的 6 个。
   选中之后直接作为 /canvas/api/generate 的 model 下发，不再走「生花 G1/G2」这类虚名。 */
const IMAGE_MODELS = [
  { id: 'gpt-image-2.5-flare', label: 'gpt-image-2.5-flare（默认·已验证）' },
  { id: 'gpt-image-2.5-sunburst', label: 'gpt-image-2.5-sunburst' },
  { id: 'gpt-image-2', label: 'gpt-image-2' },
  { id: 'nano-banana-2', label: 'nano-banana-2（最快）' },
  { id: 'Qwen-Image', label: 'Qwen-Image' },
  { id: 'Z-Image-Turbo', label: 'Z-Image-Turbo' },
];
/* 12 份风格卡（与 src/assets/styleSkills.js、docs/style-skills/*.md 同源，这里只放前端展示用的精简五维）。
   「风格预览」右侧按选中的风格把光线/色彩/质感/镜头/情绪摊开，出图跑偏时能一眼看出哪一维没落地。 */
const STYLE_CARDS = {
  '电影写实': {
    cn: '单侧硬光的明暗交界 + 青橙双色 + 35mm 电影景深与颗粒，像院线片截帧。',
    anchors: ['单侧硬光', '明暗交界', '青橙分离', '电影景深'],
    light: '主光只从一侧 45° 上方打，半亮半沉，暗部留细节', color: '肤色偏橙、阴影偏青，低饱和', texture: '35mm 浅景深 + 轻颗粒，保留毛孔', camera: '35–50mm 中景，留负空间，机位略低', mood: '克制、有叙事压力，不看镜头',
    card: '01-cinematic.md',
  },
  '都市剧写实': {
    cn: '大窗自然光 + 中性白平衡 + 高清锐利，像国产都市剧官方剧照。',
    anchors: ['大窗自然光', '中性白平衡', '高清锐利', '体面干净'],
    light: '侧前方大窗为主，顶灯补到 1:2，几乎无硬阴影', color: '中性略偏冷白，饱和度正常', texture: '数字机干净锐利，轻修但留肤质', camera: '35–50mm 中景，平视，构图端正', mood: '职业、体面，在做事不摆姿势',
    card: '02-urban-tv.md',
  },
  '纪实跟拍': {
    cn: '可用光不补光 + 手持呼吸感 + 真实颗粒，像记者在人堆里抓的一帧。',
    anchors: ['可用光', '手持', '运动模糊', '抓拍感'],
    light: '只用现场光，脏阴影与局部过曝都保留', color: '低饱和、真实偏色，不统一色温', texture: '高感颗粒 + 轻微运动模糊', camera: '24–35mm 广角近身，略倾斜、人物偏离中心', mood: '未经安排、有生活毛边',
    card: '03-docu.md',
  },
  '胶片质感': {
    cn: '夕阳光斜射 + 明显底片颗粒 + 高光光晕与暗角，像过期柯达扫出来的写真。',
    anchors: ['夕阳光', '底片颗粒', '光晕', '褪色暖调'],
    light: '低角度夕阳斜射，逆光发丝镀金边，允许过曝', color: '暖黄基底、暗部偏棕红、绿偏青黄，褪色 10%', texture: '粗颗粒 + halation + 轻暗角 + 微色差', camera: '50mm f/2 浅景深，视角略低，构图松弛', mood: '怀旧、温柔，有时间感',
    card: '04-film-grain.md',
  },
  '国剧质感': {
    cn: '柔顶光 + 左右双轮廓光 + 暖白肤色 + 服化考究，像大剧定妆海报。',
    anchors: ['柔顶光', '双轮廓光', '暖白肤色', '服化考究'],
    light: '顶部大柔光压脸，左右两道轮廓光勾发际肩线', color: '暖白主调，肤色偏暖不发黄，环境压饱和', texture: '高清干净，丝麻纹理清晰，留鼻梁高光', camera: '50–85mm 中近景，平视略高，对称留白', mood: '端方、有身份感，在对峙或宣示',
    card: '05-cn-drama.md',
  },
  '港风写实': {
    cn: '实景霓虹当光源 + 硬侧光切半脸 + 青绿阴影配品红高光，像九十年代港片一格。',
    anchors: ['霓虹实景光', '硬侧光', '青绿阴影', '胶片光晕'],
    light: '霓虹灯牌主光斜切，半明半暗，湿地面反光作底光', color: '青绿对品红，阴影偏绿，高光染色', texture: '胶片颗粒 + 光晕 + 轻色散，湿反光', camera: '28mm 低机位仰拍，荷兰角 5–10°', mood: '孤独、危险、江湖气',
    card: '06-hk.md',
  },
  '韩剧质感': {
    cn: '大柔光铺满全身、几乎无阴影、奶油色阶、通透发亮的皮肤，像韩剧海报。',
    anchors: ['全柔光', '高调', '奶油色阶', '通透皮肤'],
    light: '正面大面积柔光，1:1.5，几乎无硬阴影，顶部薄逆光', color: '奶白/淡粉/雾蓝，低饱和高明度', texture: '通透带水感但不油，奶油虚化、几乎无颗粒', camera: '85mm f/1.4 极浅景深，平视居中', mood: '温柔、克制的心动',
    card: '07-kr.md',
  },
  '短剧写实': {
    cn: '强边缘光把人从黑背景拔出来 + 高对比高饱和 + 竖屏构图，像爆款短剧第一帧。',
    anchors: ['强边缘光', '高对比', '高饱和', '竖屏特写'],
    light: '背后侧 30° 强边缘光勾发丝肩线，正面柔补', color: '高对比高饱和，暗部偏冷青蓝', texture: '锐利 HDR 感 + 轻光晕，面料看得出档次', camera: '竖屏 9:16，35mm 中近景，人物占 2/3，机位略低', mood: '强情绪强冲突，一句话就翻脸',
    card: '08-short-drama.md',
  },
  '动漫电影': {
    cn: '手绘线稿 + 平涂色块 + 动画电影级逆光体积光，像新海诚或京都动画一帧。',
    anchors: ['赛璐璐平涂', '手绘线稿', '动画逆光', '光斑'],
    light: '强逆光发丝发亮，体积光斜射，阴影是分色不是渐变', color: '天蓝橘金明快，阴影用同色相深一档', texture: '清晰线稿 + 平涂色块 + 水彩动画背景', camera: '电影构图，广角空镜与低机位仰拍', mood: '青春、怅惘，明亮里带失落',
    card: '09-anime-film.md',
  },
  '3D 国漫': {
    cn: '次表面散射的通透皮肤 + 体积光穿雾 + PBR 材质，像《哪吒》《深海》那一档。',
    anchors: ['次表面散射', '体积光', 'PBR 材质', '高级灰'],
    light: '三点柔光 + 窄轮廓光描边 + 天空光补底，体积光穿雾', color: '低饱和高级灰（灰蓝/墨绿/暗金），SSS 透红', texture: '皮肤半透、发丝分组、布料金属各向异性', camera: '50mm 缓推缓拉，浅景深，中心对角平衡', mood: '史诗、庄重、有神性',
    card: '10-3d-cn.md',
  },
  '吉卜力动画': {
    cn: '水彩晕染的天空草地 + 暖融融自然光 + 圆润手绘角色，像宫崎骏电影安静的午后。',
    anchors: ['水彩背景', '手绘线稿', '暖自然光', '圆润造型'],
    light: '大面积暖自然光，云隙光与斑驳树影，阴影是暖灰暖绿', color: '水彩高饱和自然色：天蓝草绿奶油黄砖红', texture: '水彩纸笔触水痕 + 平涂 + 柔和细线稿', camera: '广角风景 + 人物中景，机位偏低或平视', mood: '宁静、温暖，日常里的诗意',
    card: '11-ghibli.md',
  },
  '赛博朋克': {
    cn: '紫青双色霓虹 + 湿滑地面镜面反射 + 雾雨与全息投影，像银翼杀手那一侧的世界。',
    anchors: ['紫青霓虹', '湿反光', '雾雨', '机能材质'],
    light: '紫青双向夹光，霓虹主光，体积雾成光柱，没有太阳光', color: '洋红紫对青绿、暗蓝过渡，肤色被染色', texture: '湿亮雾三件套，机能布料/PVC/金属/全息膜', camera: '24mm 低机位仰拍，轻鱼眼，前景遮挡', mood: '冷、疏离、被技术包裹的孤独',
    card: '12-cyberpunk.md',
  },
};

const LIVE_FILTER = {
  '电影写实': 'contrast(1.04) saturate(.96)',
  '都市剧写实': 'brightness(1.06) contrast(1.06) saturate(1.08)',
  '纪实跟拍': 'saturate(.62) contrast(1.12)',
  '胶片质感': 'sepia(.22) contrast(1.06) saturate(.92)',
  '国剧质感': 'hue-rotate(-8deg) saturate(.94) brightness(1.04)',
  '港风写实': 'hue-rotate(14deg) saturate(1.18) contrast(1.1)',
  '韩剧质感': 'brightness(1.14) saturate(.9) contrast(.96)',
  '短剧写实': 'contrast(1.14) saturate(1.06)',
};

/* ================= 顶部四个模块 ================= */
function tabsBar(d) {
  const items = [
    { id: 'script', name: '剧本设定', meta: d.script ? `${d.script.episodes?.length ?? 0}集剧本` : '无剧本' },
    { id: 'style', name: '风格设置', meta: d.style?.preset || '无风格' },
    { id: 'assets', name: '主体资产', meta: `${(d.cast?.length ?? 0) + (d.scenes?.length ?? 0) + (d.props?.length ?? 0)}项` },
    { id: 'work', name: '分集管理', meta: `${d.works?.length ?? 0}项` },
  ];
  return `<div class="cw-tabs">${items.map((t) => `<button class="cw-tab ${d.tab === t.id ? 'is-on' : ''}" data-cwtab="${t.id}">
    <b>${esc(t.name)}</b><span>${esc(t.meta)}</span></button>`).join('')}</div>`;
}

/* ================= ① 剧本设定 ================= */
function scriptView(d) {
  if (!d.script) {
    return `<div class="card">
      <div class="card-head"><div><h2>剧本设定</h2>
        <div class="sub">生成全集剧本，并选择单集剧本开始视频创作</div></div>
        <button class="btn btn-sm" data-cwact="toStyle">${ICONS.spark}风格设置 →</button></div>
      <div class="cw-import">
        <div class="cw-import-main">
          <div class="cw-oneflow">
            <div class="cw-oneflow-head">
              <b>一句话成剧</b>
              <span>写一句话设定，自动出「故事 + 分集大纲 + 前几集正文」，落到下面的剧本里</span>
            </div>
            <textarea id="cwIdea" class="editable" rows="3" placeholder="例：被赶出豪门婚礼的赘婿，其实是掌控半城地产的隐形富豪；前妻当众撕掉他的工牌，三分钟后董事会全体到场">${esc(d.idea ?? '')}</textarea>
            <div class="cw-oneflow-row">
              <label>题材
                <select id="cwGenre">${['逆袭', '复仇', '甜宠', '悬疑', '战神', '重生', '追妻', '搞笑'].map((g) => `<option value="${g}" ${d.genre === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
              </label>
              <label>总集数
                <input id="cwEpCount" type="number" min="1" max="40" value="${d.epCount || 10}">
              </label>
              <label>先写几集
                <select id="cwEpWrite">
                  <option value="1">只写第 1 集（最快）</option>
                  <option value="2">前 2 集</option>
                  <option value="3">前 3 集</option>
                </select>
              </label>
              <span style="flex:1"></span>
              <button class="btn btn-primary btn-sm" data-cwact="oneflow" ${d.flow ? 'disabled' : ''}>${ICONS.spark}一键成剧</button>
            </div>
            ${d.flow ? `<div class="cw-oneflow-tip is-run">${esc(d.flow)}</div>` : `<div class="cw-oneflow-tip">一次会调用 3–5 次文本模型，约 1–3 分钟；写完可以直接去「主体资产」提取角色、出资产图。</div>`}
          </div>
          <div class="cw-ways">
            <label class="btn btn-primary btn-sm" for="cwFile">上传剧本文件</label>
            <button class="btn btn-sm" data-cwact="focusPaste">手动输入 / 粘贴</button>
            <button class="btn btn-sm" data-cwact="pickProject">导入现有剧本项目</button>
          </div>
          <input type="file" id="cwFile" accept=".txt,.md,.json" hidden>
          <div class="cw-drop" data-cwact="focusPaste">
            <div class="cw-drop-icon">${ICONS.box ?? ICONS.spark}</div>
            <b>点击或拖拽剧本至此处开始上传</b>
            <span>支持上传 txt、md、json（docx 请先另存为 txt），大小 ≤ 30MB</span>
          </div>
          <textarea id="cwPaste" class="editable" rows="8" placeholder="也可以直接把剧本粘在这里：第1集 独占一行，场次写成 1-1 日 外 医美中心，人物：写在人物行…">${esc(d.raw ?? '')}</textarea>
          <div class="actions">
            ${busyBtn('cwParse', '解析并载入剧本', 'spark')}
            <span class="muted" style="font-size:10.5px">按「第X集」切集、按「X-X」切场；解析完就能进主体资产</span>
          </div>
        </div>
        <aside class="cw-import-help">
          <h3>剧本格式说明</h3>
          <p class="muted">若上传剧本的格式与规定格式不符，可能会影响剧本解析结果。</p>
          <h4>拆分单集格式示意</h4>
          <ol>
            <li>"第"字开头，"集"字结尾</li>
            <li>"第X集"内部不要有空格和其他符号，且独立成行</li>
            <li>X 为阿拉伯数字或汉字</li>
          </ol>
          <pre class="cw-spec">第3集

3-1场 周身识海 日内（金色汪洋·威严神国）
出场角色:蛟龙之魂、周启神念化身
△蛟龙之魂的虚影撞入一片无边无际的金色海洋，周围是奔涌不息的法力。
蛟龙之魂（震撼）:这是什么地方？!这是谁的神识海?!</pre>
          <h4>拆分场次格式示意</h4>
          <ol>
            <li>符合"X-X"格式</li>
            <li>X 为阿拉伯数字</li>
            <li>X-X 位于该行文字开头</li>
          </ol>
          <pre class="cw-spec">1-38 联邦司·刑房点刑处 日内

出场角色:司礼役、鲁校尉、众刑者
△鲁校尉面无表情地分派任务。
鲁校尉:……点刑，是一件脏活。
△声音粗粝，周围的刑者们倒吸一口冷气纷纷投来同情的目光。</pre>
        </aside>
      </div>
    </div>`;
  }

  const eps = d.script.episodes ?? [];
  const sel = eps.find((e) => Number(e.ep) === Number(d.selEp)) ?? eps[0] ?? { ep: 1, scenes: [] };
  const raw = (sel.raw ?? sel.text ?? '').trim() || `（第 ${sel.ep} 集没有正文：解析时只拿到了场次结构）`;
  return `<div class="card">
    <div class="card-head"><div><h2>剧本设定</h2>
      <div class="sub">生成全集剧本，并选择单集剧本开始视频创作 · 共 ${eps.length} 集 · ${d.stats?.scenes ?? 0} 场 · ${d.stats?.lines ?? 0} 句台词 · ${d.stats?.characters ?? 0} 人物</div></div>
      <div class="chip-row">
        <button class="btn btn-sm" data-cwact="downloadScript">${ICONS.download}下载剧本</button>
        <button class="btn btn-sm" data-cwact="addEp">${ICONS.spark}追加分集</button>
        <button class="btn btn-sm" data-cwact="editScript">${ICONS.copy}手动编辑</button>
        <button class="btn btn-sm btn-primary" data-cwact="toStyle">风格设置 →</button>
      </div></div>
    <div class="cw-script">
      <div class="cw-ep-list">
        <div class="cw-ep-count">共 ${eps.length} 集</div>
        ${eps.map((e) => `<button class="cw-ep ${Number(e.ep) === Number(sel.ep) ? 'is-on' : ''}" data-cwep="${esc(e.ep)}">
          <b>第 ${esc(e.ep)} 集</b><span class="cw-ep-tag">${(e.scenes?.length ?? 0)} 场</span></button>`).join('')}
      </div>
      <article class="cw-ep-body">
        <h3>第 ${esc(sel.ep)} 集</h3>
        <pre class="cw-ep-text">${esc(raw)}</pre>
      </article>
    </div>
    <div class="cw-foot"><button class="btn btn-primary" data-cwact="done">完 成</button></div>
  </div>`;
}

/* ================= ② 风格设置 ================= */
function styleView(d) {
  const s = d.style ?? {};
  const sel = (v, cur) => (v === cur ? 'selected' : '');
  return `<div class="card">
    <div class="card-head"><div><h2>风格设置</h2><div class="sub">先定画风，后面主体资产和分镜都按这个画风出</div></div>
      <button class="btn btn-sm btn-primary" data-cwact="toAssets">主体资产 →</button></div>
    <div class="cw-style">
      <div class="cw-style-left">
        <label class="field"><span class="fl">绘图模型</span>
          <select data-cwstyle="model">
            ${IMAGE_MODELS.map((m) => `<option value="${m.id}" ${sel(m.id, s.model)}>${m.label}</option>`).join('')}
          </select>
          <span class="hint">理解力更强，文字更准确，直出更真实</span></label>
        <label class="field"><span class="fl">图片模型名</span>
          <input class="editable" data-cwstyle="imgModel" placeholder="留空 = 用画布配置里的默认模型" value="${esc(s.imgModel ?? '')}">
          <span class="hint">主体资产出图走这个模型；上游报「模型不存在或已被删除」时，把充值后真实的模型名填这里</span></label>
        <div class="cw-style-tpl">
          <span class="fl">绘图模板</span>
          <div class="cw-tpl-row"><em>角色</em><select data-cwstyle="role">
            <option ${sel('单特写+三视图', s.role)}>单特写+三视图</option>
            <option ${sel('单特写', s.role)}>单特写</option>
            <option ${sel('不使用', s.role)}>不使用</option></select></div>
          <div class="cw-tpl-row"><em>场景</em><select data-cwstyle="scene">
            <option ${sel('不使用', s.scene)}>不使用</option>
            <option ${sel('无人场景图', s.scene)}>无人场景图</option>
            <option ${sel('场景+人物', s.scene)}>场景+人物</option></select></div>
          <div class="cw-tpl-row"><em>道具</em><select data-cwstyle="prop">
            <option ${sel('不使用', s.prop)}>不使用</option>
            <option ${sel('单图', s.prop)}>单图</option>
            <option ${sel('三视图', s.prop)}>三视图</option></select></div>
        </div>
        <span class="fl" style="margin-top:12px;display:block">绘图风格</span>
        <div class="notice notice-info" style="margin:0 0 8px">仿真人短剧就用前排这 8 个「真人」风格（默认电影写实）；选动漫/国漫/吉卜力会出 2D 卡通风。</div>
        <div class="cw-radio"><span class="${s.custom ? '' : 'is-on'}">● 预设风格</span><span class="${s.custom ? 'is-on' : ''}">○ 自定义风格</span></div>
        <textarea class="editable" rows="3" data-cwstyle="custom" placeholder="自定义风格：一句话写清画风（例：低饱和胶片感，冷蓝夜景，写实人影）">${esc(s.custom ?? '')}</textarea>
        <div class="cw-cats">${STYLE_CATS.map((c) => `<span class="cw-cat">${esc(c)}</span>`).join('')}</div>
        <div class="cw-grid">${STYLE_GRID.map((g) => `<button class="cw-card ${s.preset === g ? 'is-on' : ''}" data-cwpreset="${esc(g)}" title="${esc(STYLE_CARDS[g]?.cn || g)}">
          ${STYLE_SAMPLE[g]
      ? `<span class="cw-card-img"><img src="${STYLE_SAMPLE[g]}" alt="${esc(g)}" loading="lazy"></span>`
      : `<span class="cw-card-img"><img src="/assets/style-ref-live-3.jpg" alt="" style="filter:${esc(LIVE_FILTER[g] || 'none')}"></span>`}<b>${esc(g)}</b></button>`).join('')}</div>
      </div>
      <div class="cw-style-right">${stylePreview(s)}</div>
    </div>
  </div>`;
}

/** 右侧风格预览：样图 + 一句话方向 + 锚点 + 五维配方（对应 docs/style-skills 里的同名卡） */
function stylePreview(s) {
    const g = s?.preset;
    if (!g) return `<div class="cw-preview-head">风格预览</div><div class="cw-preview"><span>选择风格查看效果</span></div>`;
    const card = STYLE_CARDS[g];
    const img = STYLE_SAMPLE[g] ? `<span class="cw-preview-img"><img src="${STYLE_SAMPLE[g]}" alt="${esc(g)}"></span>` : '';
    if (!card) {
      return `<div class="cw-preview-head">风格预览</div><div class="cw-preview"><b>${esc(g)}</b>${img}<span>已选风格：出图与分镜提示词都会带上这套画风描述</span></div>`;
    }
    const row = (k, v) => (v ? `<li><em>${k}</em>${esc(v)}</li>` : '');
    return `<div class="cw-preview-head">风格预览</div>
      <div class="cw-preview">
        <b>${esc(g)}</b>
        ${img}
        <div class="cw-card-cn">${esc(card.cn)}</div>
        <div class="cw-anchors">${card.anchors.map((a) => `<i>${esc(a)}</i>`).join('')}</div>
        <ul class="cw-recipe">
          ${row('光线', card.light)}${row('色彩', card.color)}${row('质感', card.texture)}${row('镜头', card.camera)}${row('情绪', card.mood)}
        </ul>
        <div class="cw-card-file">风格卡 · docs/style-skills/${esc(card.card)}</div>
      </div>`;
    }

/* ================= ③ 主体资产 ================= */
/** 资产图的提示词：角色走参考板、场景走空景分栏、道具走四视图（模板见 drama-asset-prompt.js） */
function assetPrompt(c, v, d, kind = 'cast') {
  return assetSheetPrompt(kind, c, v, {
    style: d.style?.preset || d.style?.custom || '电影写实',
    template: d.style?.role || '单特写+三视图',
  });
}

/* 资产键 'cast:0:0' → 对应的分类 / 条目 / 版本；三处（点卡看提示词、存提示词、重出）共用 */
const ASSET_KINDS = { cast: 'cast', scene: 'scenes', prop: 'props' };
function assetAt(d, key) {
  const [kind, ci, vi] = String(key ?? '').split(':');
  const list = d[ASSET_KINDS[kind] ?? 'cast'] ?? [];
  const item = list[Number(ci)];
  const v = item?.versions?.[Number(vi)];
  return item && v ? { kind: kind || 'cast', ci: Number(ci), vi: Number(vi), item, v } : null;
}
/** 提示词输入框改一个字就落一条：不重绘，避免打断正在打的长句 */
export function setAssetPrompt(key, text) {
  const d = SLOT();
  const hit = assetAt(d, key);
  if (!hit) return;
  hit.v.prompt = text;
  persist(d);
}

function assetView(d) {
  const tab = ASSET_KINDS[d.assetTab] ? d.assetTab : 'cast';
  const LABEL = { cast: '角色', scene: '场景', prop: '道具' };
  const list = d[ASSET_KINDS[tab]] ?? [];
  const all = [...(d.cast ?? []), ...(d.scenes ?? []), ...(d.props ?? [])];
  const done = all.reduce((a, c) => a + (c.versions ?? []).filter((v) => v.img).length, 0);
  const total = all.reduce((a, c) => a + (c.versions ?? []).length, 0);
  return `<div class="card">
    <div class="card-head"><div><h2>主体资产</h2><div class="sub">共 ${all.length} 项 · 角色 ${d.cast?.length ?? 0} · 场景 ${d.scenes?.length ?? 0} · 道具 ${d.props?.length ?? 0} · 已出图 ${done}/${total}</div></div>
      <div class="chip-row">
        <label class="cw-switch"><span>展示多版本</span><input type="checkbox" data-cwmulti checked></label>
        <button class="btn btn-sm btn-primary" data-cwact="toWork">分集管理 →</button>
      </div></div>
    <div class="cw-asset-bar">
      <div class="cw-asset-tabs">${[['cast', '角色'], ['scene', '场景'], ['prop', '道具']].map(([k, l]) =>
    `<span class="${tab === k ? 'is-on' : ''}" data-cwact="assetTab" data-cwarg="${k}">${l} <em>${(d[ASSET_KINDS[k]] ?? []).length}</em></span>`).join('')}</div>
      <div class="chip-row">
        <button class="btn btn-sm" data-cwact="extract">${ICONS.spark}智能提取</button>
        <button class="btn btn-sm btn-primary" data-cwact="genAllInit">${ICONS.spark}一键生成全部资产图</button>
        <button class="btn btn-sm" data-cwact="genAllImg">${ICONS.grid}生成全部版本</button>
        <button class="btn btn-sm" data-cwact="imgModel">${ICONS.spark}图片模型</button>
        ${tab === 'cast' ? `<button class="btn btn-sm" data-cwact="addChar">+ 新增角色</button>` : ''}
      </div>
    </div>
    ${list.length ? `<div class="cw-chars">${list.map((c, ci) => {
    const kind = tab;
    return `<div class="cw-char">
      <div class="cw-char-head"><input type="checkbox" class="cw-ck">
        <b>${esc(c.name)}</b><span class="muted" style="font-size:11px">${esc(c.desc ?? '')}</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-cwact="genAssetAll" data-cwarg="${kind}:${ci}">生成该${LABEL[kind]}全部</button>
        ${kind === 'cast' ? `<button class="btn btn-sm" data-cwact="addVersion" data-cwarg="${esc(c.name)}">+ 版本</button>` : ''}</div>
      <div class="cw-vers">${(c.versions ?? []).map((v, vi) => {
      const key = `${kind}:${ci}:${vi}`;
      return `<div class="cw-ver ${v.img ? 'has-img' : ''} ${d.assetEdit === key ? 'is-edit' : ''}">
        ${v.img
        ? `<img class="cw-ver-photo" src="${esc(v.img)}" alt="${esc(v.name)}" loading="lazy" data-cwact="assetEdit" data-cwarg="${key}" title="点这张图看 / 改它的生成提示词">`
        : `<div class="cw-ver-img" data-cwact="assetEdit" data-cwarg="${key}" title="点一下看 / 改它的生成提示词">${v.imgStatus === 'run' ? '<span class="cw-ver-run">生成中…</span>' : ICONS.grid}</div>`}
        <b>${esc(v.name)}</b><span>${esc(v.desc ?? '')}</span>
        ${v.imgErr ? `<em class="cw-ver-err">${esc(String(v.imgErr).slice(0, 64))}</em>` : ''}
        <div class="cw-ver-foot">
          <button class="btn btn-xs" data-cwact="genAsset" data-cwarg="${key}" ${v.imgStatus === 'run' ? 'disabled' : ''}>${v.img ? '重出这张' : '生成这张'}</button>
          <button class="btn btn-xs" data-cwact="assetEdit" data-cwarg="${key}">提示词 ${d.assetEdit === key ? '▴' : '›'}</button>
        </div>
        ${d.assetEdit === key ? `<div class="cw-ver-prompt">
          <div class="cw-ver-prompt-tip">这张图的生成提示词，改完点「保存并重出」；中文长句会被上游安全审核拦，建议保持英文</div>
          <textarea class="editable" rows="5" data-cwassetprompt="${key}" placeholder="English prompt…">${esc(v.prompt || assetPrompt(c, v, d, kind))}</textarea>
          <div class="cw-ver-prompt-foot">
            <button class="btn btn-xs" data-cwact="assetReset" data-cwarg="${key}">还原默认</button>
            <span style="flex:1"></span>
            <button class="btn btn-xs btn-primary" data-cwact="genAsset" data-cwarg="${key}">保存并重出</button>
          </div></div>` : ''}
      </div>`;
    }).join('')}</div>
    </div>`;
  }).join('')}</div>`
    : `<div class="empty"><div class="eicon">${ICONS.spark}</div><h3>还没有${LABEL[tab]}</h3>
        <p>点「智能提取」：从剧本的「人物：」行、场次标题和道具词里把角色 / 场景 / 道具抽出来。</p></div>`}
  </div>`;
}

/* ================= ④ 分集管理 ================= */
function workView(d) {
  const works = d.works ?? [];
  const w = works.find((x) => Number(x.no) === Number(d.openWork));
  if (w) {
    // 三层：集 → 分镜卡片 → 单段提示词
    const seg = (w.shots?.segments ?? []).find((s) => s.id === d.openSeg);
    if (seg) return segDetail(d, w, seg);
    return workDetail(d, w);
  }
  return `<div class="card">
    <div class="card-head"><div><h2>分集管理</h2><div class="sub">共 ${works.length} 项 · 每集三步：主体 → 分镜 → 视频 · 点卡片进去改提示词</div></div>
      <div class="chip-row">
        <button class="btn btn-sm" data-cwact="matchAll">${ICONS.check}匹配主体</button>
        <button class="btn btn-sm" data-cwact="boardAll">${ICONS.grid}生成分镜</button>
        <button class="btn btn-sm" data-cwact="videoAll">${ICONS.spark}生成分镜视频</button>
        <button class="btn btn-sm btn-primary" data-cwact="oneflow">${ICONS.spark}一键成片</button>
        <button class="btn btn-sm" data-cwact="downloadAll">${ICONS.download}下载全部视频</button>
        <button class="btn btn-sm" data-cwact="mergeAll">${ICONS.grid}合成全部视频</button>
        <button class="btn btn-sm btn-primary" data-cwact="newWork">+ 新建分集</button>
      </div></div>
    <div class="cw-work-bar">
      <span class="muted">分集状态：<i class="cw-dot"></i>未进行　<i class="cw-dot is-run"></i>进行中　<i class="cw-dot is-fail"></i>失败　<i class="cw-dot is-ok"></i>完成</span>
    </div>
    ${works.length ? `<div class="cw-works">${works.map((w) => {
      const segs = w.shots?.segments?.length ?? 0;
      const secs = (w.shots?.segments ?? []).reduce((a, s) => a + (Number(s.sec) || 0), 0);
      const takes = Object.values(w.takes ?? {}).flat().filter((k) => k.url);
      // 主体匹配情况：一集里对上了几个角色、几个场景
      const mSegs = (w.shots?.segments ?? []).filter((s) => s.match).length;
      const castN = (w.shots?.segments ?? []).reduce((a, s) => a + ((s.match?.cast ?? []).filter((c) => c.ok).length), 0);
      const sceneN = (w.shots?.segments ?? []).filter((s) => s.match?.scene?.ok).length;
      const dots = [['main', '主体'], ['board', '分镜'], ['video', '视频']].map(([k, n]) => {
        const st = w.status?.[k];
        return `<span class="cw-work-st ${st === 'done' ? 'is-ok' : st === 'run' ? 'is-run' : st === 'fail' ? 'is-fail' : ''}">${n}</span>`;
      }).join('');
      return `<div class="cw-work" data-cwwork="${esc(w.no)}" title="点进去看提示词、改完再出第二版">
      <div class="cw-work-thumb">${ICONS.grid}</div>
      <b>第 ${esc(w.no)} 集</b>
      <span class="cw-work-type">漫剧</span>
      <div class="cw-work-meta">${segs ? `${segs} 段 · ${secs}s` : '未拆镜'}${mSegs ? ` · 主体 ${castN}角/${sceneN}景` : ''}${takes.length ? ` · 成片 ${takes.length}` : ''}</div>
      ${takes[0] ? `<video class="cw-work-vid" src="${esc(takes[0].url)}" controls preload="metadata"></video>` : ''}
      <div class="cw-work-foot">${dots}<span style="flex:1"></span><span class="cw-work-open">详情 ›</span></div>
    </div>`;
    }).join('')}</div>`
      : `<div class="empty"><div class="eicon">${ICONS.box}</div><h3>暂无分集</h3>
          <p>点「新建分集」：选剧本范围（1–N 集），批量创建全集或手动创建单集。</p></div>`}
    ${d.flow ? `<div class="notice notice-info" style="margin-top:12px">${ICONS.refresh}<div data-cwflow>${esc(d.flow)}</div></div>` : ''}
  </div>`;
}

/* 分集详情：这一集由多个分镜组成，摊成卡片，点某张卡进单段提示词 */
function workDetail(d, w) {
  const segs = w.shots?.segments ?? [];
  const takes = w.takes ?? {};
  const secs = segs.reduce((a, s) => a + (Number(s.sec) || 0), 0);
  if (!segs.length) {
    return `<div class="card">
      <div class="card-head"><div><h2>第 ${esc(w.no)} 集</h2><div class="sub">这一集还没拆镜</div></div>
        <button class="btn btn-sm" data-cwact="backWork">← 返回分集管理</button></div>
      <div class="empty"><div class="eicon">${ICONS.grid}</div><h3>还没有分镜</h3>
        <p>回分集管理点「生成全部分镜」，出了段就能在这里逐段改提示词。</p></div>
    </div>`;
  }
  const made = Object.values(takes).flat().filter((k) => k.url).length;
  return `<div class="card">
    <div class="card-head"><div><h2>第 ${esc(w.no)} 集 · 分镜（${segs.length} 个）</h2>
      <div class="sub">共 ${segs.length} 个分镜 · ${secs}s · 已成片 ${made} 个 · 点任一分镜进提示词</div></div>
      <div class="chip-row">
        <button class="btn btn-sm" data-cwact="backWork">← 返回分集管理</button>
        <button class="btn btn-sm btn-primary" data-cwact="genAllTakes">生成本集全部（每个分镜一版）</button>
      </div></div>
    ${d.flow ? `<div class="notice notice-info" style="margin-bottom:10px">${ICONS.refresh}<div data-cwflow>${esc(d.flow)}</div></div>` : ''}
    <div class="cw-scards">${segs.map((s, i) => {
    const t = (takes[s.id] ?? []).filter((k) => k.url);
    const pd = (takes[s.id] ?? []).find((k) => k.pending);
    const warnN = (w.shots?.warns ?? []).filter((x) => x.seg === s.id).length;
    return `<div class="cw-scard ${t.length ? 'has' : ''}" data-cwseg="${esc(s.id)}" title="点开改提示词、单独重跑">
      <div class="cw-scard-thumb">${t.length
      ? `<video src="${esc(t[0].url)}" preload="metadata" muted playsinline></video>`
      : `${ICONS.grid}<span class="cw-scard-no">${i + 1}</span>`}</div>
      <b>${esc(s.id)}</b>
      <div class="cw-scard-meta">${esc(String(s.sec || ''))}s · ${s.shots?.length ?? 0} 镜${warnN ? ` · <em class="cw-warn-n">待改 ${warnN}</em>` : ''}</div>
      <div class="cw-scard-foot">
        <span class="cw-scard-st ${t.length ? 'is-ok' : ''}">${pd ? `V${pd.ver} 生成中…` : t.length ? `已出 ${t.length} 版` : '未生成'}</span>
        <span class="cw-work-open">提示词 ›</span>
      </div>
    </div>`;
  }).join('')}</div>
  </div>`;
}

/* 单个分镜：提示词全文 + 可改 + 可单独重跑出新版本 */
function segDetail(d, w, s) {
  const all = w.takes?.[s.id] ?? [];
  const rows = segAssetRows(d, s);   // 这一段实际会带上的主体资产图
  const t = all.filter((k) => k.url);
  const pend = all.find((k) => k.pending);
  const verNext = all.length + 1;
  const edited = d.prompts?.[s.id] !== undefined;
  const no = (w.shots?.segments ?? []).findIndex((x) => x.id === s.id) + 1;
  return `<div class="card">
    <div class="card-head">
      <div><h2>${esc(s.id)} · 提示词</h2>
        <div class="sub">第 ${esc(w.no)} 集 · 第 ${no} 个分镜 · ${esc(String(s.sec || ''))}s · ${s.shots?.length ?? 0} 镜${edited ? ' · 提示词已改过' : ''}</div></div>
      <div class="chip-row">
        <button class="btn btn-sm" data-cwact="backSeg">← 回第 ${esc(w.no)} 集分镜</button>
        ${pend
      ? `<button class="btn btn-sm" disabled>V${pend.ver} 生成中…</button>`
      : `<button class="btn btn-sm btn-primary" data-cwact="genTake" data-cwarg="${esc(s.id)}">生成第 ${verNext} 版</button>`}
      </div></div>
    ${d.flow ? `<div class="notice notice-info" style="margin-bottom:10px">${ICONS.refresh}<div data-cwflow>${esc(d.flow)}</div></div>` : ''}
    ${(() => {
    const warns = (w.shots?.warns ?? []).filter((x) => x.seg === s.id);
    if (!warns.length) return '';
    return `<div class="cw-board-check">
      <div class="cw-board-check-head"><b>分镜体检</b><span>${warns.length} 条 · 红的是会废片的问题，黄的是能靠剪辑补的</span></div>
      <ul>${warns.slice(0, 14).map((x) => `<li class="${x.level === 'bad' ? 'is-bad' : ''}"><em>${esc(x.shot || '整段')}</em>${esc(x.msg)}</li>`).join('')}</ul>
      ${warns.length > 14 ? `<div class="cw-board-check-more">还有 ${warns.length - 14} 条，改完这几条再看</div>` : ''}
    </div>`;
  })()}
    <div class="cw-seg-assets" style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="muted" style="font-size:11.5px">主体参考：</span>
      ${rows.length ? rows.map((r, i) => `<span class="tag teal" title="${esc(r.kind === 'scene' ? '场景' : r.kind === 'prop' ? '道具' : '角色')}的资产图">@${esc(r.name)} · ref_image_${i}</span>`).join(' ')
      : '<span class="muted" style="font-size:11.5px">这一段没匹配到资产图，回分集管理点「匹配主体」</span>'}
    </div>
    <label class="field"><span class="fl">提示词（随便改，改完点右上「生成第 ${verNext} 版」）</span>
      <textarea class="editable cw-seg-prompt" rows="16" data-cwprompt="${esc(s.id)}">${esc(segPromptText(d, s))}</textarea></label>
    <div class="cw-seg-foot">
      <button class="btn btn-xs" data-cwact="resetPrompt" data-cwarg="${esc(s.id)}">还原引擎原提示词</button>
      <span class="cw-seg-tip">同一段可以出多版，旧的不会丢，挑最好的一条留着</span>
    </div>
    ${t.length ? `<div class="cw-takes">${t.map((k) => `<div class="cw-take">
      <div class="cw-take-no">V${k.ver}</div>
      <video src="${esc(k.url)}" controls preload="metadata"></video>
      <a class="cw-take-dl" href="/canvas/api/download?url=${encodeURIComponent(k.url)}" download="${esc(s.id)}-V${k.ver}.mp4">↓ 存到本机</a>
    </div>`).join('')}</div>` : `<div class="empty" style="padding:22px 0"><div class="eicon">${ICONS.spark}</div>
      <p>这一段还没出片，点右上「生成第 1 版」。</p></div>`}
  </div>`;
}

/* ================= 视图 ================= */
/* 顶部两枚状态灯：漫剧真正依赖的是画布那两路（图片模型 / ComfyUI 视频工作流），
 * 不是文本大模型——早先挂 llmModeLabel 才会出现「图都出完了还写着未接入」 */
function engineTags(d) {
  const e = d.engine;
  if (!e) return '<span class="tag outline">正在探测图片 / 视频模型…</span>';
  if (e.err) return `<span class="tag red" title="${esc(e.err)}">画布服务异常</span>`;
  // 令牌配了但没分组权限 → 图片照样能出，只把原因挂在视频标签上，别让整条横幅变红（会误以为图片也废了）
  const vidTitle = e.vid ? 'ComfyUI 分组令牌 + 工作流枚举' : (e.note || 'ComfyUI 分组令牌 + 工作流枚举');
  const imgTitle = e.img ? `上游 ${esc(e.base || 'www.autodl.art')}`
    : (e.imgErr ? `图片令牌失效：${esc(e.imgErr)}` : '还没配图片令牌');
  const imgText = e.img ? `图片已接入${e.model ? ` · ${esc(e.model)}` : ''}`
    : (e.imgErr ? '图片令牌失效' : '图片未接入');
  return `<span class="tag ${e.img ? 'teal' : 'amber'}" title="${imgTitle}">${imgText}</span>
    <span class="tag ${e.vid ? 'teal' : 'amber'}" title="${esc(vidTitle)}">${e.vid ? `视频已接入 · ${e.wf} 个工作流` : (e.note ? '视频无出片权限' : '视频未接入')}</span>`;
}

/* 实探一次画布状态：令牌配了不等于能用，还要看分组权限和工作流枚举 */
async function probeEngine(d) {
  if (d.engine && !d.engine.err && Date.now() - (d.engine.at ?? 0) < 30000) return;
  const e = { at: Date.now(), img: false, vid: false, model: '', wf: 0, base: '', err: '', note: '', imgErr: '' };
  try {
    const s = await (await fetch('/canvas/api/status')).json();
    e.img = Boolean(s.imageReady);
    e.imgErr = s.imageErr || '';      // 配了令牌但 models 接口 401：这才是「接上了却出不了图」的真因
    e.model = s.imageModel || '';
    e.base = s.baseUrl || '';
    e.wf = Object.values(s.workflows ?? {}).filter(Boolean).length;
    e.vid = Boolean(s.configured) && Boolean(s.permission?.ok) && e.wf > 0;
    // 只有「令牌配了但缺分组权限」才记原因；图片通路不受这个影响，不该连累图片灯
    e.note = s.configured && !s.permission?.ok ? (s.permission?.message || '令牌缺少对应的分组权限') : '';
  } catch { e.err = '画布子服务没起来（5180），图片 / 视频都调不了'; }
  d.engine = e;
  persist(d); render();
}

export function viewComic() {
  const d = SLOT();
  const body = d.tab === 'style' ? styleView(d) : d.tab === 'assets' ? assetView(d) : d.tab === 'work' ? workView(d) : scriptView(d);
  setTimeout(() => { probeEngine(d).catch(() => { /* 探测失败不挡页面 */ }); }, 0);
  return pageHead('创作入口', '漫剧工作台',
    '剧本设定 → 风格设置 → 主体资产 → 分集管理：一条链把剧本拆成能出片的分集，最后一步真调视频模型。',
    `<span class="tag purple">四段结构</span>${engineTags(d)}`)
    + tabsBar(d) + body;
}

/* ================= 行为 ================= */
export function setTab(id) {
  const d = SLOT();
  d.tab = id;
  // 进资产页顺手补齐空分类：场景/道具常年 0 项时点进去只有空态，用户会以为按钮坏了。
  // 「手动编辑」会把 d.script 清空（原文其实还在 d.raw），这里按原文重新解析一遍，不丢用户的东西。
  if (id === 'assets') {
    if (!d.script && String(d.raw ?? '').trim().length >= 60) {
      try { d.script = parseScriptText(d.raw); } catch { /* 解析不了就不补，别把页面弄崩 */ }
    }
    if (d.script) {
      const ex = extractSubjects(d.script, d.outline);
      for (const k of ['cast', 'scenes', 'props']) {
        if (!(d[k] ?? []).length) { const got = ex[k] ?? []; if (got.length) d[k] = got; }
      }
    }
  }
  commit(d);
}

export async function readFile(input) {
  const d = SLOT();
  const f = input?.files?.[0];
  if (!f) return;
  if (/\.docx?$/i.test(f.name)) return toast('docx 先在 Word 里另存为 txt 再传（前端不拆 docx 包）', 'warn');
  const text = await f.text();
  d.raw = text;
  commit(d);
  toast(`已读入 ${f.name}（${text.length} 字符），点「解析并载入剧本」`);
}

export async function act(name, arg) {
  const d = SLOT();
  switch (name) {
    case 'focusPaste':
      document.getElementById('cwPaste')?.focus();
      break;
    case 'pickProject': {
      const ps = (state.data.projects ?? []).slice(0, 12);
      if (!ps.length) return toast('作品库里还没有项目：先用「AI 剧本生成」建一个', 'warn');
      d.raw = ps.map((p) => `第1集\n${p.title ?? ''}\n${String(p.outline ?? p.concept ?? '').slice(0, 400)}`).join('\n\n');
      commit(d);
      toast(`已把 ${ps.length} 个项目摘要放进粘贴框，可直接解析`);
      break;
    }
    case 'downloadScript': {
      const eps = d.script?.episodes ?? [];
      if (!eps.length) return toast('还没有剧本', 'warn');
      download(`${d.script?.title ?? '漫剧'}-剧本.txt`,
        eps.map((e) => String(e.raw ?? e.text ?? '')).join('\n\n'));
      break;
    }
    case 'editScript':
      d.tab = 'script';
      d.script = null;
      commit(d);
      toast('已退回编辑态：改完粘贴框再解析一次');
      break;
    case 'addEp': {
      const eps = d.script?.episodes ?? [];
      const next = (eps.at(-1)?.ep ?? 0) + 1;
      d.script.episodes = [...eps, { ep: next, scenes: [], raw: `第${next}集\n\n1-1 日 内 待补场景\n人物：\n△（待写）` }];
      d.stats = { ...(d.stats ?? {}), episodes: d.script.episodes.length };
      commit(d);
      toast(`已追加空集：第 ${next} 集`);
      break;
    }
    case 'toStyle': d.tab = 'style'; commit(d); break;
    case 'toAssets': d.tab = 'assets'; commit(d); break;
    case 'toWork': d.tab = 'work'; commit(d); break;
    case 'done': d.tab = 'assets'; commit(d); break;
    case 'oneflow': {
      const idea = String(document.querySelector('#cwIdea')?.value ?? '').trim();
      if (idea.length < 8) return toast('先写一句完整设定（至少 8 个字）', 'warn');
      const genre = String(document.querySelector('#cwGenre')?.value ?? '逆袭');
      const epCount = Math.max(1, Math.min(40, Number(document.querySelector('#cwEpCount')?.value) || 10));
      const epWrite = Math.max(1, Math.min(3, Number(document.querySelector('#cwEpWrite')?.value) || 1));
      d.idea = idea; d.genre = genre; d.epCount = epCount;
      const step = (s) => { d.flow = s; commit(d); };
      try {
        step('① 写故事与人物小传…');
        const story = (await api.genStory({ concept: idea, genre, episodes: epCount })).story;
        step('② 拆分集大纲…');
        const outline = (await api.genOutline({ story })).outline;
        const texts = [];
        for (let i = 1; i <= epWrite; i += 1) {
          step(`③ 写第 ${i} 集正文（${i}/${epWrite}）…`);
          const r = await api.genEpisode({ story, outline, ep: i, prevEnding: String(texts[i - 2] ?? '').slice(-160) });
          texts.push(String(r.text ?? ''));
        }
        step('④ 组装整稿并登记角色 / 场景…');
        const r4 = await api.genAssemble({ story, outline, texts });
        d.raw = String(r4.text ?? '');
        d.script = r4.script ?? d.script;
        d.stats = r4.stats ?? null;
        d.selEp = 1;
        // 主体直接按大纲建：名字 / 身份 / 场景 / 道具都是结构化给的，比正则从正文里捞稳
        const os = r4.outline ?? outline ?? {};
        const subs = subjectsFromOutline(os);
        if (subs.cast.length) d.cast = subs.cast;
        if (subs.scenes.length) d.scenes = subs.scenes;
        if (subs.props.length) d.props = subs.props;
        d.outline = os;   // 留着：后面「智能提取」「补分类」「拆镜对锚点」都要读它
        d.works = (d.script?.episodes ?? []).map((e) => ({
          no: Number(e.ep), status: { main: 'done', board: '', video: '' }, shots: null, takes: {},
        }));
        d.flow = null;
        commit(d);
        toast(`一键成剧完成：${epCount} 集大纲 · 已写 ${texts.length} 集 · 角色 ${subs.cast.length} · 场景 ${subs.scenes.length} · 道具 ${subs.props.length}`);
      } catch (e) {
        d.flow = null;
        commit(d);
        toast(`一键成剧失败：${String(e.message ?? e).slice(0, 90)}`, 'err');
      }
      break;
    }
    case 'extract': {
      if (!d.script) return toast('先在剧本设定里载入剧本', 'warn');
      const { cast, scenes, props } = extractSubjects(d.script, d.outline);
      d.cast = cast; d.scenes = scenes; d.props = props;
      commit(d);
      toast(`提取完成：角色 ${cast.length} · 场景 ${scenes.length} · 道具 ${props.length}`);
      break;
    }
    case 'addChar':
      d.cast = [...(d.cast ?? []), { name: `新角色 ${d.cast.length + 1}`, desc: '点这里改描述', versions: [{ name: '初始版', desc: '初始形象' }] }];
      commit(d);
      break;
    case 'addVersion': {
      const c = (d.cast ?? []).find((x) => x.name === arg);
      if (!c) return;
      c.versions = [...(c.versions ?? []), { name: `版本 ${(c.versions?.length ?? 0) + 1}`, desc: `第 N 集的换装状态` }];
      commit(d);
      break;
    }
    case 'newWork': {
      const n = d.script?.episodes?.length ?? 0;
      if (!n) return toast('先载入剧本，才知道有几集', 'warn');
      d.works = (d.script.episodes ?? []).map((e) => ({
        no: Number(e.ep), status: { main: 'done', board: '', video: '' }, shots: null, videos: [],
      }));
      d.tab = 'work';
      d.openWork = null;   // 建完停在分集列表，别自己跳进第 1 集（那里还没拆镜，一看就是空的）
      d.openSeg = null;
      commit(d);
      toast(`已批量创建 ${d.works.length} 集`);
      break;
    }
    case 'matchAll': {
      if (!d.works?.length) return toast('先新建分集', 'warn');
      const n = matchAllWorks(d);
      commit(d);
      toast(n.msg);
      break;
    }
    case 'oneflow': {
      if (!d.works?.length) return toast('先新建分集', 'warn');
      const eps = d.script?.episodes ?? [];
      const boardNeed = d.works.filter((w) => !(w.shots?.segments?.length)).length;
      const segNeed = d.works.reduce((a, w) => a + ((w.shots?.segments ?? []).filter((s) => !(w.takes?.[s.id] ?? []).some((k) => k.url)).length), 0);
      if (!window.confirm(`一键成片：共 ${d.works.length} 集\n缺分镜 ${boardNeed} 集 · 待出片 ${segNeed} 段\n会先匹配主体 → 补分镜 → 逐段出片（按段计费）。继续？`)) return;
      // ① 主体匹配：出片前先把角色/场景对到资产图
      const mn = matchAllWorks(d);
      commit(d);
      // ② 补分镜
      for (let i = 0; i < d.works.length; i++) {
        const w = d.works[i];
        if (w.shots?.segments?.length) continue;
        const ep = eps.find((e) => Number(e.ep) === Number(w.no));
        if (!ep) { w.status.board = 'fail'; w.err = '剧本里没有这一集'; commit(d); continue; }
        d.flow = `拆镜 ${i + 1}/${d.works.length}：第 ${w.no} 集…`;
        commit(d);
        try {
          const r = await api.splitShots({ script: { episodes: [ep] }, ep: Number(w.no), aspect: '9:16' });
          w.shots = r;
          w.status.board = r.degraded ? 'fail' : 'done';
          for (const s of r.segments ?? []) s.match = matchSeg(d, w, s);
          w.status.main = 'done';
        } catch (e) {
          w.status.board = 'fail';
          w.err = String(e.message ?? e).slice(0, 120);
        }
        commit(d);
      }
      // ③ 逐集出片
      for (let i = 0; i < d.works.length; i++) {
        const w = d.works[i];
        const segs = w.shots?.segments ?? [];
        if (!segs.length) continue;
        const todo = segs.filter((s) => !(w.takes?.[s.id] ?? []).some((k) => k.url));
        if (!todo.length) { w.status.video = 'done'; commit(d); continue; }
        for (const s of todo) if (!s.match) s.match = matchSeg(d, w, s);
        const miss = [...new Set(todo.flatMap((s) => segMissingAssets(d, s)))];
        if (miss.length) {
          w.status.video = 'fail';
          w.err = `缺资产图：${miss.join('、')}`;
          commit(d);
          continue;
        }
        d.openWork = Number(w.no);
        d.tab = 'work';
        d.flow = `出片 ${i + 1}/${d.works.length}：第 ${w.no} 集…`;
        commit(d);
        await act('genAllTakes');
        w.status.video = (w.takes && Object.keys(w.takes).length) ? 'done' : 'fail';
        commit(d);
      }
      d.flow = null;
      d.openWork = null;
      commit(d);
      toast(`一键成片跑完：${mn.msg}`);
      break;
    }
    case 'boardAll': {
      if (!d.works?.length) return toast('先新建分集', 'warn');
      const eps = d.script?.episodes ?? [];
      d.flow = '正在拆全部分镜…';
      commit(d);
      let ok = 0;
      for (const w of d.works) {
        const ep = eps.find((e) => Number(e.ep) === Number(w.no));
        if (!ep) continue;
        d.flow = `第 ${w.no} 集拆分镜…`;
        commit(d);
        try {
          const r = await api.splitShots({ script: { episodes: [ep] }, ep: Number(w.no), aspect: '9:16' });
          w.shots = r;
          w.status.board = r.degraded ? 'fail' : 'done';
          // 拆完立刻匹配主体：出片时才知道该贴哪张资产图
          for (const s of r.segments ?? []) s.match = matchSeg(d, w, s);
          w.status.main = 'done';
          ok++;
        } catch (e) {
          w.status.board = 'fail';
          w.err = String(e.message ?? e).slice(0, 120);
        }
        commit(d);
      }
      d.flow = null;
      commit(d);
      toast(`分镜完成：${ok}/${d.works.length} 集`);
      break;
    }
    case 'videoAll': {
      if (!d.works?.length) return toast('先新建分集', 'warn');
      const one = d.works.find((w) => w.shots?.segments?.length);
      if (!one) return toast('先「生成分镜」，没有分镜就没有提示词', 'warn');
      // 出片前先过一遍主体匹配，保证每段都带着角色 / 场景的资产图
      const mn = matchAllWorks(d);
      commit(d);
      toast(mn.msg);
      // 整集一起跑：以前只跑第 1 段（15s），看起来像"一集只有 15 秒"，这次按段全跑
      d.openWork = Number(one.no);
      d.tab = 'work';
      commit(d);
      await act('genAllTakes');
      break;
    }
    case 'downloadAll': {
      const vids = (d.works ?? []).flatMap((w) => Object.values(w.takes ?? {}).flat().filter((v) => v.url));
      if (!vids.length) return toast('还没有成片', 'warn');
      vids.slice(0, 6).forEach((v, i) => setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/canvas/api/download?url=${encodeURIComponent(v.url)}`;
        a.download = `${v.segId ?? 'clip'}_V${v.ver ?? 1}.mp4`;
        a.click();
      }, i * 900));
      toast(`开始下载 ${vids.length} 段（浏览器会逐条弹保存）`);
      break;
    }
    case 'mergeAll':
      return toast('合成整集要 ffmpeg：这一版还没接，先把各段下载下来（下一步再接拼接）', 'warn');

    /* ---- 分集 → 分镜 → 单段 ---- */
    case 'openWork': d.tab = 'work'; d.openWork = Number(arg); d.openSeg = null; d.flow = null; commit(d); break;
    case 'backWork': d.openWork = null; d.openSeg = null; d.flow = null; commit(d); break;
    case 'openSeg': d.openSeg = String(arg); commit(d); break;
    case 'backSeg': d.openSeg = null; commit(d); break;
    case 'resetPrompt': {
      delete (d.prompts ?? {})[String(arg)];
      commit(d);
      toast('已还原引擎给的原始提示词');
      break;
    }
    case 'genTake': {
      const w = (d.works ?? []).find((x) => (x.shots?.segments ?? []).some((s) => s.id === arg));
      const s = w?.shots?.segments?.find((x) => x.id === arg);
      if (!w || !s) return toast('找不到这一段', 'warn');
      if (!s.match) s.match = matchSeg(d, w, s);
      const miss = segMissingAssets(d, s);
      if (miss.length) return toast(`先出资产图：${miss.join('、')} 还没有图，去「主体资产」点「一键生成全部资产」`, 'warn');
      await genSeg(d, w, s);
      break;
    }
    case 'genAllTakes': {
      const w = (d.works ?? []).find((x) => Number(x.no) === Number(d.openWork));
      if (!w) return toast('先打开一集', 'warn');
      const segs = w.shots?.segments ?? [];
      if (!segs.length) return toast('这一集还没拆镜', 'warn');
      const todo = segs.filter((s) => !(w.takes?.[s.id] ?? []).some((k) => k.url));
      if (!todo.length) return toast('这一集每一段都有成片了', 'warn');
      // 老数据没匹配过 → 现算一遍，别让参考图空着
      for (const s of todo) if (!s.match) s.match = matchSeg(d, w, s);
      // 顺序不能跳：角色没有资产图，出片就是让模型凭空编人
      const miss = [...new Set(todo.flatMap((s) => segMissingAssets(d, s)))];
      if (miss.length) return toast(`先出资产图：${miss.join('、')} 还没有图，去「主体资产」点「一键生成全部资产」`, 'warn');
      d.openSeg = null;          // 批量跑时停在集的分镜卡片页，别跳进单段
      // 一集由多段组成：先把没成片的段全部提交出去（各自排队），再逐段盯结果，
      // 比「一段跑完再提交下一段」省掉成倍的空等时间
      const sent = [];
      for (let i = 0; i < todo.length; i++) {
        const s = todo[i];
        d.flow = `第 ${w.no} 集：提交第 ${i + 1}/${todo.length} 段（${s.id}）`;
        commit(d);
        try { sent.push({ s, rec: await submitSeg(d, w, s) }); } catch (e) { toast(`${s.id} 提交失败：${String(e.message ?? e).slice(0, 60)}`, 'err'); }
      }
      for (let i = 0; i < sent.length; i++) {
        const { s, rec } = sent[i];
        d.flow = `第 ${w.no} 集：等第 ${i + 1}/${sent.length} 段（${s.id}）出片`;
        commit(d);
        try { await waitTake(d, w, s, rec); } catch (e) { toast(`${s.id} 失败：${String(e.message ?? e).slice(0, 60)}`, 'err'); }
      }
      d.flow = null;
      commit(d);
      toast(`第 ${w.no} 集已跑完：${segs.length} 段 / ${segs.reduce((a, s) => a + (Number(s.sec) || 0), 0)}s`);
      break;
    }

    /* ---- 主体资产：三分类切换 / 点卡看提示词 / 出图 ---- */
    case 'assetTab':
      d.assetTab = ASSET_KINDS[String(arg)] ? String(arg) : 'cast';
      d.assetEdit = null;
      commit(d);
      break;
    case 'assetEdit':
      d.assetEdit = d.assetEdit === String(arg) ? null : String(arg);   // 再点一次收起来
      commit(d);
      break;
    case 'assetReset': {
      const hit = assetAt(d, arg);
      if (!hit) return toast('找不到这张图', 'warn');
      delete hit.v.prompt;
      commit(d);
      toast('已还原这条资产的默认提示词');
      break;
    }
    case 'genAsset': {
      const hit = assetAt(d, arg);
      if (!hit) return toast('找不到这张图', 'warn');
      await genAssetImage(d, hit.item, hit.v, hit.kind);
      break;
    }
    case 'genAssetAll': {
      const [kind, ci] = String(arg ?? '').split(':');
      const item = d[ASSET_KINDS[kind] ?? 'cast']?.[Number(ci)];
      if (!item) return toast('找不到这一项', 'warn');
      for (const v of item.versions ?? []) await genAssetImage(d, item, v, kind || 'cast');
      toast(`${item.name} 的 ${(item.versions ?? []).length} 个版本都跑完了`);
      break;
    }
    case 'genChar': {
      const [ci, vi] = String(arg ?? '').split(':').map(Number);
      const c = d.cast?.[ci];
      const v = c?.versions?.[vi];
      if (!c || !v) return toast('找不到这个版本', 'warn');
      await genAssetImage(d, c, v, 'cast');
      break;
    }
    case 'genCharAll': {
      const c = d.cast?.[Number(arg)];
      if (!c) return toast('找不到这个角色', 'warn');
      for (const v of c.versions ?? []) await genAssetImage(d, c, v, 'cast');
      toast(`${c.name} 的 ${(c.versions ?? []).length} 个版本都跑完了`);
      break;
    }
    case 'genAllInit': {
      const groups = [['cast', d.cast], ['scene', d.scenes], ['prop', d.props]];
      const totalItems = groups.reduce((a, [, l]) => a + (l?.length ?? 0), 0);
      if (!totalItems) return toast('先「智能提取」，还没有角色 / 场景 / 道具', 'warn');
      let ok = 0;
      for (const [kind, l] of groups) {
        for (const c of l ?? []) {
          const v = (c.versions ?? [])[0];
          if (!v) continue;
          d.assetTab = kind;       // 出图时停在对应分类，能看见进度
          commit(d);
          if (await genAssetImage(d, c, v, kind)) ok++;
        }
      }
      toast(`初始版出图：${ok}/${totalItems}（角色 + 场景 + 道具）`);
      break;
    }
    case 'genAllImg': {
      const groups = [['cast', d.cast], ['scene', d.scenes], ['prop', d.props]];
      if (!groups.some(([, l]) => l?.length)) return toast('先「智能提取」', 'warn');
      let ok = 0; let total = 0;
      for (const [kind, l] of groups) {
        for (const c of l ?? []) {
          for (const v of c.versions ?? []) { total++; if (await genAssetImage(d, c, v, kind)) ok++; }
        }
      }
      toast(`全部出图：${ok}/${total}`);
      break;
    }
    case 'imgModel': {
      const cur = d.style?.imgModel || '';
      const next = window.prompt('图片模型名（留空 = 用画布配置里的默认）\n充好额度后把上游真实模型名填这里', cur || '');
      if (next === null) return;
      d.style = { ...(d.style ?? {}), imgModel: String(next).trim() };
      commit(d);
      toast(d.style.imgModel ? `图片模型设为 ${d.style.imgModel}` : '已清空，回落到画布默认模型');
      break;
    }
    default: break;
  }
}

/* 单张资产图：调图片模型（同步返回），base64 的先落盘再存地址，避免把 localStorage 撑爆 */
async function genAssetImage(d, c, v, kind = 'cast') {
  v.imgStatus = 'run';
  persist(d); render();
  try {
    // 卡片上手改过的提示词优先；没改过就用模板现生成（场景 / 道具各有自己的模板）
    const prompt = String(v.prompt || assetPrompt(c, v, d, kind)).trim();
    // 模型优先级：手填「图片模型名」覆盖 > 「绘图模型」下拉 > 画布配置默认
    const model = String(d.style?.imgModel || d.style?.model || '').trim();
    const r = await fetch('/canvas/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'image', prompt, ratio: '16:9',   // 参考板是横构图分栏（左脸 + 右三视图 + 细节条），必须 16:9
        ...(model ? { model } : {}),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    let url = (j.results ?? []).find((x) => x.type === 'image')?.url || '';
    if (!url) throw new Error(j.error || '上游没返回图片');
    if (url.startsWith('data:')) {
      const up = await fetch('/canvas/api/upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: url }),
      });
      const uj = await up.json().catch(() => ({}));
      if (uj.url) url = `/canvas/${uj.url}`;
    }
    v.img = url;
    v.imgStatus = 'done';
    v.imgErr = '';
    return true;
  } catch (e) {
    v.imgStatus = 'fail';
    v.imgErr = String(e.message ?? e).slice(0, 140);
    return false;
  } finally {
    persist(d); render();
  }
}

/* 单段出片：用当前提示词跑一次，结果追加成新版本（V1 / V2 …） */
/* 段里的 cast 只存了编号（C01/C02），名字在提示词的 @[C01_林秋婉-初始版] 里，
 * 这里统一解析成 编号 → 名字，三处（资产引用 / 参考图 / 缺图检查）都用它 */
function segCastNames(s) {
  const map = new Map();
  for (const m of String(s?.prompt ?? '').matchAll(/@\[(C\d+)_([^\]-]+)-初始版\]/g)) map.set(m[1], m[2].trim());
  for (const id of s?.cast ?? []) {
    const raw = String(id);
    const key = raw.split('_')[0];
    if (!map.has(key)) map.set(key, raw.includes('_') ? raw.replace(/^C\d+_/, '') : raw);
  }
  return map;
}
/* ---------------- 主体匹配：把分镜里的角色 / 场景 / 道具对到资产库 ---------------- */
/* 名字要模糊比：剧本写「林小雨」、资产库写「小雨」也要能对上，但别把俩角色错配 */
const normName = (x) => String(x ?? '').replace(/[\s·・,，。、（）()]/g, '').toLowerCase();

function pickAsset(list, name) {
  const n = normName(name);
  if (!n) return null;
  const arr = list ?? [];
  const exact = arr.find((x) => normName(x.name) === n);
  if (exact) return exact;
  const alias = arr.find((x) => (x.aliases ?? []).some((a) => normName(a) === n));
  if (alias) return alias;
  // 只允许「包含」但要求长度接近，避免「小雨」命中「小雨妈」
  const inc = arr.filter((x) => {
    const xn = normName(x.name);
    return xn && (xn.includes(n) || n.includes(xn)) && Math.abs(xn.length - n.length) <= 1;
  });
  return inc[0] ?? null;
}

/* 资产最新一张能直接拉取的图（重出图后 match 里存的老图要跟着换） */
function assetImg(list, name) {
  const item = pickAsset(list, name);
  const v = (item?.versions ?? []).find((x) => /^https?:\/\//i.test(String(x.img ?? '')));
  return v ? v.img : '';
}

function sceneNameOfWork(d, w, s) {
  const ep = (d.script?.episodes ?? []).find((e) => Number(e.ep) === Number(w.no));
  const sc = ep?.scenes?.[Number(s.sceneIndex) - 1];
  return sc?.name ?? '';
}

/* 给一段算匹配结果：
 * 角色 = 引擎给的 s.cast + 原文里出现过的角色名（引擎漏标就靠这条兜）
 * 场景 = sceneIndex 指的场景 + 原文命中的场景资产名（解析写「未命名场地」时靠后半句）
 * 道具 = 名字在原文里出现 */
function matchSeg(d, w, s) {
  const ep = (d.script?.episodes ?? []).find((e) => Number(e.ep) === Number(w.no));
  const sc = ep?.scenes?.[Number(s.sceneIndex) - 1];
  const hay = normName([s.prompt, sc?.name, JSON.stringify(sc?.flow ?? [])].filter(Boolean).join(' '));
  const names = segCastNames(s);
  const cast = [];
  const addCast = (key, name) => {
    const c = pickAsset(d.cast ?? [], name);
    const nm = c?.name ?? name;
    if (cast.some((x) => normName(x.name) === normName(nm))) return;
    cast.push({ key: c?.id ?? key ?? `C${cast.length + 1}`, name: nm, ok: !!c });
  };
  for (const id of s.cast ?? []) {
    const k = String(id).split('_')[0];
    addCast(k, names.get(k) ?? k);
  }
  for (const c of d.cast ?? []) {
    const n = normName(c.name);
    if (n.length >= 2 && hay.includes(n)) addCast(c.id ?? `C${cast.length + 1}`, c.name);
  }
  const scName = sceneNameOfWork(d, w, s);
  const scHit = (scName ? pickAsset(d.scenes ?? [], scName) : null)
    ?? (d.scenes ?? []).find((x) => { const n = normName(x.name); return n.length >= 2 && hay.includes(n); });
  const props = [];
  for (const p of d.props ?? []) {
    const pn = normName(p.name);
    if (pn.length >= 2 && hay.includes(pn)) props.push({ name: p.name });
  }
  return {
    cast,
    scene: (scHit || scName) ? { name: scHit?.name ?? scName, ok: !!scHit } : null,
    props,
    at: Date.now(),
  };
}

/* 全部集一次匹配：每段算一次 s.match，并把集的状态标成已匹配 */
function matchAllWorks(d) {
  let segs = 0, castHit = 0, castTotal = 0, sceneHit = 0, sceneTotal = 0;
  for (const w of d.works ?? []) {
    const ss = w.shots?.segments ?? [];
    if (!ss.length) continue;
    for (const s of ss) {
      s.match = matchSeg(d, w, s);
      segs++;
      for (const c of s.match.cast ?? []) { castTotal++; if (c.ok) castHit++; }
      if (s.match.scene) { sceneTotal++; if (s.match.scene.ok) sceneHit++; }
    }
    w.status = w.status ?? {};
    w.status.main = 'done';
  }
  return {
    segs,
    msg: `主体匹配：${segs} 段 · 角色 ${castHit}/${castTotal} · 场景 ${sceneHit}/${sceneTotal}`,
  };
}

/* 该段的角色 → 已出图的资产（有序，用于提示词 ref_image_N 与真实参考图一一对应） */
function segAssetRows(d, s) {
  const rows = [];
  // ① 匹配过的段：按 match 顺序取（角色 → 场景 → 道具），图每次从资产库现取最新
  if (s.match) {
    for (const c of s.match.cast ?? []) {
      const img = assetImg(d.cast ?? [], c.name) || assetImg(d.cast ?? [], c.key);
      if (img) rows.push({ key: c.key, name: c.name, img, kind: 'cast' });
    }
    if (s.match.scene?.ok) {
      const img = assetImg(d.scenes ?? [], s.match.scene.name);
      if (img) rows.push({ key: 'S', name: s.match.scene.name, img, kind: 'scene' });
    }
    for (const p of s.match.props ?? []) {
      const img = assetImg(d.props ?? [], p.name);
      if (img) rows.push({ key: 'P', name: p.name, img, kind: 'prop' });
    }
    return rows.slice(0, 6);
  }
  // ② 没匹配过（老数据 / 直接出片）：退回按名字找角色，场景道具先不带
  const names = segCastNames(s);
  for (const id of s.cast ?? []) {
    const key = String(id).split('_')[0];
    const name = names.get(key) ?? key;
    const img = assetImg(d.cast ?? [], name) || assetImg(d.cast ?? [], key);
    if (img) rows.push({ key, name, img, kind: 'cast' });
  }
  return rows;
}

/* 资产引用块：把「哪个主体 → 第几张参考图」写进提示词，人看得懂、模型也对得上 */
function assetRefBlock(d, s) {
  const rows = segAssetRows(d, s);
  if (!rows.length) return '';
  const tip = {
    cast: '五官、发型、服装、配饰必须与该图完全一致',
    scene: '场景布置、光位、道具位置必须与该图一致',
    prop: '道具的造型、材质、颜色必须与该图一致',
  };
  return `\n[资产引用]\n${rows.map((r, i) => `@[${r.key}_${r.name}-初始版] = 参考图 ref_image_${i}（${r.name}；${tip[r.kind] ?? tip.cast}）`).join('\n')}\n`;
}

/* 这一段真正用的提示词：没改过 = 引擎原稿 + 资产引用；改过就用改过的 */
function segPromptText(d, s) {
  const edited = d.prompts?.[s.id];
  if (edited !== undefined) return String(edited);
  return `${String(s.prompt ?? '')}${assetRefBlock(d, s)}`;
}

/* 这一段的参考图：只收上游可直接拉取的 http(s) 资产图（本机 /uploads 路径上游取不到） */
function segRefImages(d, s) {
  return segAssetRows(d, s).map((r) => r.img).slice(0, 6);   // 顺序必须和提示词 ref_image_N 一致
}

/* 这一段还缺哪些角色的资产图（缺了就不该出片，否则画面里的人是凭空编的） */
function segMissingAssets(d, s) {
  const missing = [];
  // 匹配过的段：角色和场景都算，缺图就拦住（场景没有图，模型会自己编个屋子出来）
  if (s.match) {
    for (const c of s.match.cast ?? []) {
      if (c.ok && !assetImg(d.cast ?? [], c.name)) missing.push(c.name);
    }
    if (s.match.scene?.ok && !assetImg(d.scenes ?? [], s.match.scene.name)) missing.push(`场景：${s.match.scene.name}`);
    return missing;
  }
  const names = segCastNames(s);
  for (const id of s.cast ?? []) {
    const key = String(id).split('_')[0];
    const name = names.get(key) ?? key;
    const c = (d.cast ?? []).find((x) => x.name === name || x.id === key);
    if (!c) continue;                                    // 抽不到的角色（群演）不拦
    const has = (c.versions ?? []).some((v) => /^https?:\/\//i.test(String(v.img ?? '')));
    if (!has) missing.push(name);
  }
  return missing;
}

/* 只提交、不等待：taskId 立刻落盘并返回。批量时先把整集都提交出去，再统一盯 */
async function submitSeg(d, w, s) {
  const prompt = segPromptText(d, s).trim();
  if (!prompt) throw new Error('提示词是空的');
  w.takes = w.takes ?? {};
  const list = w.takes[s.id] ?? [];
  const busy = list.find((k) => k.pending);
  if (busy) throw new Error(`V${busy.ver} 还在生成中，等它出片再重出`);   // 一段同时只跑一条，免得白扣费
  const ver = list.length + 1;
  d.flow = `${s.id} V${ver} 提交中…`;
  persist(d); render();
  const r = await fetch('/canvas/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'video', prompt,
      duration: Math.round(Number(s.sec) || 15),
      resolution: '480p竖',
      refImages: segRefImages(d, s),   // 有资产图就走图生视频，把角色贴上去
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.mock) {
    d.flow = null; persist(d); render();
    throw new Error(j.error || (j.mock ? '视频模型没就绪' : `HTTP ${r.status}`));
  }
  // 提交成功先把 taskId 落盘：刷新、切页、关掉再开都能接着查，不重跑也不重复扣费
  const rec = { ver, taskId: j.taskId, at: Date.now(), prompt: prompt.slice(0, 200), pending: true };
  RESUMING.add(j.taskId);   // 这条由本流程自己盯着；否则 render→resumePending 会再接管一遍，同版写两条
  w.takes[s.id] = [...list, rec];
  d.flow = `${s.id} V${ver} 已提交，排队中…`;
  persist(d); render();
  return rec;
}

/* 单段：提交 + 等它出片 */
async function genSeg(d, w, s) {
  const rec = await submitSeg(d, w, s);
  return waitTake(d, w, s, rec);
}

/* 盯住一个已提交的 taskId 直到出片（页面重进时也走这条，接着查而不是重发） */
async function waitTake(d, w, s, rec) {
  const t0 = Date.now();
  let last = {};
  for (let i = 0; i < 500; i++) {
    last = await (await fetch(`/canvas/api/generate/${encodeURIComponent(rec.taskId)}`)).json().catch(() => ({}));
    if (last.status === 'done' || last.status === 'error') break;
    d.flow = `${s.id} V${rec.ver} 生成中 ${Math.round((Date.now() - t0) / 1000)}s…`;
    persist(d);
    const el = document.querySelector('[data-cwflow]');
    if (el) el.textContent = d.flow; else render();   // 只改文字：整页 render 会把 <video> 打回 0 秒
    await new Promise((r2) => setTimeout(r2, 4000));
  }
  const drop = () => { RESUMING.delete(rec.taskId); w.takes[s.id] = (w.takes[s.id] ?? []).filter((k) => k.taskId !== rec.taskId); };
  if (last.status !== 'done') {
    drop(); d.flow = null; persist(d);
    throw new Error(last.message || '视频生成失败');
  }
  const url = (last.results ?? []).find((x) => x.type === 'video')?.url || (last.results ?? [])[0]?.url || '';
  if (!url) { drop(); d.flow = null; persist(d); throw new Error('上游没返回视频地址'); }
  drop();
  // 落片时按版本号覆盖，不追加：同一版只会有一条记录
  const keep = (w.takes[s.id] ?? []).filter((k) => k.taskId !== rec.taskId && k.ver !== rec.ver);
  w.takes[s.id] = [...keep, { url, ver: rec.ver, at: Date.now(), prompt: rec.prompt }]
    .sort((a, b) => (a.ver ?? 0) - (b.ver ?? 0));
  w.status = w.status ?? {};
  w.status.video = 'done';
  d.flow = null;
  persist(d); render();
  return url;
}

/* 边打边存：只落盘、不重绘（重绘会打断正在输入的光标） */
export function saveDraft() { try { persist(SLOT()); } catch { /* 存不下不挡输入 */ } }

/* 进漫剧工作台时把上次没跑完的出片接回来：taskId 已在本地，只查不重发 */
const RESUMING = new Set();export function resumePending() {
  const d = SLOT();
  let n = 0;
  for (const w of d.works ?? []) {
    for (const [segId, arr] of Object.entries(w.takes ?? {})) {
      for (const rec of arr ?? []) {
        if (!rec?.pending || !rec.taskId || rec.url || RESUMING.has(rec.taskId)) continue;
        RESUMING.add(rec.taskId);
        const s = (w.shots?.segments ?? []).find((x) => x.id === segId) ?? { id: segId, sec: 15 };
        n++;
        waitTake(d, w, s, rec)
          .catch((e) => { d.flow = null; rec.err = String(e.message ?? e).slice(0, 120); persist(d); })
          .finally(() => { RESUMING.delete(rec.taskId); render(); });
      }
    }
  }
  // 一条 pending 都没有却还挂着「生成中 138s」，那是刷新前留下的残留文案，清掉
  if (!n && d.flow) { d.flow = null; persist(d); }
  return n;
}

/* 从剧本里抽角色 / 场景 / 道具（本地规则，零调用） */
/* 大纲 → 三类主体资产：名字 / 身份 / 复用计划都是结构化给的，不用正则从正文里猜 */
function subjectsFromOutline(outline) {
  const o = outline ?? {};
  const cast = (o.characters ?? []).filter((c) => c?.name).map((c) => ({
    name: c.name,
    desc: String([c.role, c.arc].filter(Boolean).join(' · ') || c.tier || '').slice(0, 60),
    id: c.id,
    versions: [{ name: '初始版', desc: String(c.role || c.desc || '初始形象').slice(0, 80) }],
  }));
  const scenes = (o.scenes ?? []).filter((s) => s?.name).map((s) => ({
    name: s.name,
    desc: String([s.id, s.reusePlan].filter(Boolean).join(' · ') || '空景：没有人物只有空间').slice(0, 60),
    id: s.id,
    versions: [{ name: '初始版', desc: `空景建立镜头：${s.name}` }],
  }));
  const props = (o.props ?? []).filter((p) => p?.name).map((p) => ({
    name: p.name,
    desc: String([p.id, p.function].filter(Boolean).join(' · ') || '关键道具').slice(0, 60),
    id: p.id,
    versions: [{ name: '初始版', desc: String(p.function || '正/侧/背/细节四视图').slice(0, 80) }],
  }));
  return { cast, scenes, props };
}

function extractSubjects(script, outline = null) {
  const castMap = new Map();
  const sceneMap = new Map();
  const propMap = new Map();
  const PROPS = ['日记', '本子', '流水单', '面包', '手机', '钥匙', '合同', '信封', '照片', '铁皮箱', '蜡烛', '白花', '名片', '行李箱', '房产证', '银行卡', '药盒', '老花镜'];
  // 先把大纲里的结构化主体铺进去：名字 / 身份 / 复用计划都现成，这是首选来源
  // parseScriptText 的返回值本身带 outline，所以即便没走「一句话成剧」，这里也能拿到真场景名
  const os = subjectsFromOutline(outline ?? script?.outline);
  os.cast.forEach((c) => castMap.set(c.name, c));
  os.scenes.forEach((s) => sceneMap.set(s.name, s));
  os.props.forEach((p) => propMap.set(p.name, p));
  for (const ep of script?.episodes ?? []) {
    // 集正文的整体扫描（scenes 里未必带原文）
    const raw = `${ep.raw ?? ''}\n${(ep.scenes ?? []).map((s) => `${s.head ?? ''}\n${(s.lines ?? []).map((l) => l.text ?? '').join('\n')}`).join('\n')}`;
    for (const m of raw.matchAll(/人物[：:]\s*(.+)/g)) {
      m[1].split(/[、,，/]/).map((x) => x.trim()).filter(Boolean).forEach((n) => {
        const nm = n.replace(/\*?\d*$/, '').trim();
        if (nm && !castMap.has(nm)) castMap.set(nm, { name: nm, desc: '', versions: [{ name: '初始版', desc: `初次出场：第 ${ep.ep} 集` }] });
      });
    }
    for (const m of raw.matchAll(/^(\S{1,24})\s*[（(][^）)]*[）)]\s*[:：]/gm)) {
      const nm = m[1].trim();
      if (nm && !/^[△※#]/.test(nm) && !castMap.has(nm)) castMap.set(nm, { name: nm, desc: '', versions: [{ name: '初始版', desc: `初次出场：第 ${ep.ep} 集` }] });
    }
    for (const m of raw.matchAll(/^\s*(\d+-\d+)\s*(.+)$/gm)) {
      const place = m[2].replace(/日|夜|内|外|\s/g, '').slice(0, 20);
      if (place && !sceneMap.has(place)) sceneMap.set(place, { name: place, desc: `第 ${ep.ep} 集 · 场 ${m[1]}` });
    }
    // 兜底：正文自带 sceneId 但没场景名时，也要生成一张卡；否则「场景」分类常年 0 项，点进去像是坏了
    for (const sc of ep.scenes ?? []) {
      const sid = String(sc.sceneId ?? '').trim();
      if (!sid) continue;
      if ([...sceneMap.values()].some((x) => String(x.id ?? '') === sid)) continue;
      if (sceneMap.has(`场景 ${sid}`)) continue;
      sceneMap.set(`场景 ${sid}`, {
        name: `场景 ${sid}`, desc: `第 ${ep.ep} 集 · 待补场景名`, id: sid,
        versions: [{ name: '初始版', desc: '空景建立镜头：无人物，只有空间与材质' }],
      });
    }
    // 场次里已经标的道具（sc.props）优先于词表命中
    for (const sc of ep.scenes ?? []) {
      for (const p of sc.props ?? []) {
        const nm = String(p?.name ?? p ?? '').trim();
        if (nm && !propMap.has(nm)) propMap.set(nm, { name: nm, desc: `第 ${ep.ep} 集出现`, versions: [{ name: '初始版', desc: '正/侧/背/细节四视图' }] });
      }
    }
    for (const p of PROPS) {
      if (raw.includes(p) && !propMap.has(p)) propMap.set(p, { name: p, desc: `第 ${ep.ep} 集出现` });
    }
  }
  return {
    cast: [...castMap.values()],
    scenes: [...sceneMap.values()],
    props: [...propMap.values()],
  };
}

/* 把原文按「第X集」切块：parseScriptText 只给结构（scenes/flow），正文要自己留一份，
 * 否则这个页面只能显示"第 N 集没有正文"，用户看不到自己传进来的东西。 */
function splitByEp(text) {
  const re = /^第\s*([0-9一二三四五六七八九十百零两]+)\s*集\s*(.*)$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(String(text ?? '')))) marks.push({ ep: toNumber(m[1]) || 0, at: m.index });
  const out = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    out[marks[i].ep] = text.slice(marks[i].at, end).trim();
  }
  return out;
}

export const runners = {
  /** 解析粘贴/上传的剧本文本：按「第X集」切集、按「X-X」切场 */
  async cwParse() {
    const d = SLOT();
    const dom = document.getElementById('cwPaste')?.value ?? '';
    const text = String(d.raw || dom || '');
    if (!text.trim()) return toast('先把剧本贴进来，或点「上传剧本文件」', 'warn');
    let r;
    try {
      r = parseScriptText(text);
    } catch (e) {
      return toast(`解析失败：${String(e.message ?? e).slice(0, 80)}`, 'warn');
    }
    if (!r?.ok) return toast(r?.error || '解析失败：检查「第X集」独立成行、「X-X」在行首', 'warn');
    d.raw = text;
    d.script = r.script;
    const chunks = splitByEp(text);
    for (const e of d.script?.episodes ?? []) {
      const body = chunks[Number(e.ep)];
      if (body) e.raw = body;
    }
    d.stats = r.stats ?? { episodes: r.script?.episodes?.length ?? 0 };
    d.selEp = r.script?.episodes?.[0]?.ep ?? 1;
    d.cast = []; d.scenes = []; d.props = []; d.works = [];
    commit(d);
    toast(`已载入 ${d.stats?.episodes ?? 0} 集 / ${d.stats?.scenes ?? 0} 场 / ${d.stats?.lines ?? 0} 句台词 / ${d.stats?.characters ?? 0} 人物`);
  },
};
