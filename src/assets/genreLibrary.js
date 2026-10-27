/* 题材库 —— 短剧立项的第一层输入。
 *
 * 设计来源（都在这里记下来，便于以后核对口径）：
 *   1. 中国网络视听协会《2024 微短剧行业生态洞察报告》+ DataEye 短剧热力榜：
 *      题材数量占比与热力值占比（情感 63.3% / 女频 61.8% / 逆袭 50.5% / 都市 43.2% /
 *      男频 39.3% / 家庭 20.7% / 甜宠 18.0% / 古装 14.5%），以及 2024→2025 的枯荣：
 *      家庭 +409.5%、都市 +142.4%；系统 -80%、神医 -77.8%、赘婿 -69.2%、战神 -59.4%。
 *      → 结论：题材必须有「热度档位」字段，且不能只收传统爆款。
 *   2. 红果短剧榜单标签体系（#赘婿逆袭 #萌宝 #豪门恩怨 #团建 #年代 #种田 #神医 #战神归来…）：
 *      标签是多值、可组合的，一部剧通常 3–6 个标签。
 *      → 结论：题材不是一个字符串，而是「大类 + 频道 + 时代 + 多标签」的坐标。
 *   3. lism/short-drama（GitHub，MIT）：13 种题材可组合最多 2 个；受众 女频/男频/全龄；
 *      调性 甜/虐/甜虐/爽/燃/搞笑；8 类爽感矩阵；5 种钩子类型（悬念/反转/情绪/信息/危机）；
 *      节奏曲线四段配比；付费卡点 10–15%。
 *      → 结论：题材要带「爽点优先序 + 钩子类型偏好 + 每集配比」，直接喂给大纲阶段。
 *   4. Dexter753/ai-short-drama-system（GitHub，MIT）：题材用 id + 描述（suspense/romance/
 *      timeTravel/urban/fantasy/comedy/historical/horror），并暴露 `/api/script/genres`。
 *      → 结论：id 必须稳定、后端下发，前端不硬编码中文字符串。
 *   5. A-cat-with-carrots/OnlyShot：流派（红果纯爽/精品悬疑/漫剧奇观/沙雕轻喜/年代爽剧）。
 *      → 结论：同题材要用「流派」做二次差异化，这是防串味最低成本的一刀。
 *
 * 原有 6 个题材（都市重生复仇/都市逆袭/战神归来/悬疑反转/古代宅斗/甜宠言情）标 legacy: true，
 * id 与 name 保持不变：前端 localStorage 里存的是名字，改名等于把用户的选择清空。
 */

/** 爽感矩阵：前 8 类来自 lism/short-drama，末位「反转」是国内短剧补的一类。
 *  注意「反转」是内容层的快感，和下面 HOOK_TYPES 里的「反转钩」（集尾结构）不是一回事。 */
export const THRILLS = Object.freeze(['打脸', '逆袭', '甜宠', '虐心', '悬疑', '燃', '搞笑', '感动', '反转']);

/** 5 种集尾钩子（来源同上） */
export const HOOK_TYPES = Object.freeze([
  { id: 'suspense', label: '悬念钩', desc: '抛出一个没答案的问题，观众必须点下一集才知道' },
  { id: 'twist', label: '反转钩', desc: '最后一秒推翻前面的判断（身份、动机、生死）' },
  { id: 'emotion', label: '情绪钩', desc: '把情绪顶到最高点就切断（崩溃、告白、羞辱）' },
  { id: 'info', label: '信息钩', desc: '抛一条关键信息（一份文件、一个名字、一条短信）' },
  { id: 'crisis', label: '危机钩', desc: '把主角推进新危险（围堵、病危、破产倒计时）' },
]);

/** 频道：投流口径的受众划分 */
export const CHANNELS = Object.freeze([
  { id: 'female', label: '女频' },
  { id: 'male', label: '男频' },
  { id: 'all', label: '全龄' },
]);

/** 时代：决定美术、服化、道具与可用科技（也决定 AI 出图的难度与成本） */
export const ERAS = Object.freeze([
  { id: 'modern', label: '现代', hint: '当代都市/职场/校园' },
  { id: 'retro', label: '年代', hint: '七零八零九零，乡村与厂矿' },
  { id: 'republic', label: '民国', hint: '军阀、洋场、旧上海' },
  { id: 'ancient', label: '古代', hint: '架空王朝、宅门、宫廷' },
  { id: 'fantasy', label: '仙侠/玄幻', hint: '修真、妖兽、异界' },
  { id: 'future', label: '未来/末世', hint: '废土、异能、星际' },
]);

/** 篇幅：直接对到集数与单集秒数（引擎的门按秒判，口径必须一致） */
export const FORMATS = Object.freeze([
  { id: 'micro', label: '微短剧', episodes: 40, seconds: [60, 90], hint: '竖屏付费主力，一集一个钩子' },
  { id: 'standard', label: '标准短剧', episodes: 60, seconds: [90, 120], hint: '人物关系更细，可留副线' },
  { id: 'long', label: '长剧', episodes: 100, seconds: [90, 120], hint: '多反派递进，适合系列化' },
]);

/** 大类：前端按这个分组展示，顺序即侧栏/选择器的展示顺序 */
export const GENRE_CATEGORIES = Object.freeze([
  { id: 'urban-comeback', name: '都市逆袭', hint: '被看轻的人翻身，前 3 秒给羞辱，第 6 集给反杀' },
  { id: 'romance', name: '豪门婚恋', hint: '婚姻与身份是主战场，情绪密度高于事件密度' },
  { id: 'costume', name: '古装权谋', hint: '宅门与朝堂，规则感强，靠信息差取胜' },
  { id: 'retro', name: '年代乡土', hint: '七八九零，靠场景还原与生活质感，AI 出图性价比高' },
  { id: 'fantasy', name: '玄幻仙侠', hint: '打怪升级与视觉奇观，漫剧主赛道' },
  { id: 'suspense', name: '悬疑罪案', hint: '信息控制型，靠反转与推理推进' },
  { id: 'family', name: '萌宝亲子', hint: '幼崽 + 护短，情绪最稳的流量密码' },
  { id: 'republic', name: '民国传奇', hint: '军阀洋场，虐恋与家国并行' },
  { id: 'campus-show', name: '校园娱乐', hint: '校园与娱乐圈，年轻向，梗密度高' },
]);

/**
 * 热度档位：按 DataEye 2024 数量占比与 2025 趋势粗分三档，
 * 只用于前端排序提示与文档说明，不参与任何硬判定。
 *   hot   —— 占比与热力值双高的主赛道
 *   rising—— 增速快、供给还没饱和
 *   niche —— 占比低但人群精准，适合做差异化
 */
const HEAT = { hot: 'hot', rising: 'rising', niche: 'niche' };

/**
 * 题材表。字段口径：
 *   id        稳定标识（存 project.json / 前端 state，改名不影响历史数据）
 *   name      展示名（原来的 6 个保持不变）
 *   legacy    是否为改造前就有的题材
 *   category  大类 id，见 GENRE_CATEGORIES
 *   channel   受众频道 female/male/all
 *   era       时代 id
 *   formats   适配篇幅
 *   heat      热度档位
 *   tagline   一句话定位（进提示词，也给前端做副标题）
 *   audience  目标受众（谁在看、为什么看）
 *   thrills   爽点优先序（第一项必须是本题材的主爽点）
 *   tropes    常见剧情钩子/母题（提示词里作为「可选桥段池」，不是必写清单）
 *   keywords  3–5 个标签，对应红果那套多值标签
 *   opening   示例开篇：一段可直接当 concept 用的话
 *   castBias  人物配比 { leads, villains, supports }
 *   beatBias  每集爽点配比（和 thrills 的键对齐，和为 1）
 *   pitfalls  这个题材最容易写串味的地方（进提示词的「禁令」段）
 *   variants  差异化变体：每次生成随机取一组，组合空间决定同题材不重样
 */
export const GENRES = Object.freeze([
  /* ============ 都市逆袭 ============ */
  {
    id: 'urban-rebirth-revenge',
    name: '都市重生复仇',
    legacy: true,
    category: 'urban-comeback',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '带着前世记忆回到被背叛的那一晚，把吃进去的连本带利拿回来',
    audience: '25–40 岁女性，看的是「清醒后不再受气」的代偿感',
    thrills: ['打脸', '逆袭', '虐心', '反转'],
    tropes: ['重生节点', '当众退婚', '窃取成果', '豪门认亲', '前世仇人今世相遇'],
    keywords: ['重生', '复仇', '打脸', '豪门'],
    opening:
      '苏清鸢死在二十八岁，死在丈夫和闺蜜的庆功宴上。睁眼回到二十三岁那场订婚宴，顾景琛正端着酒杯当众宣布解除婚约。她把杯子放下，先说了一句：这婚，我退。',
    castBias: { leads: 2, villains: 2, supports: 3 },
    beatBias: { 打脸: 0.35, 反转: 0.25, 虐心: 0.2, 逆袭: 0.2 },
    pitfalls: '最容易写成「重生后开挂一帆风顺」——前世信息只能用一个季度，用过头就没有紧张感',
    variants: [
      { key: 'restartPoint', label: '重生节点', values: ['订婚宴', '公司年会', '葬礼', '产房', '签约现场'] },
      { key: 'weapon', label: '复仇工具', values: ['前世记忆', '一份被藏起来的账本', '竞争对手的投名状', '妹妹的日记'] },
    ],
  },
  {
    id: 'urban-comeback',
    name: '都市逆袭',
    legacy: true,
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.hot,
    tagline: '被踩到最底的人，用一件真本事翻身，越压越强',
    audience: '20–40 岁男性，看的是「被否定后证明自己」',
    thrills: ['逆袭', '打脸', '燃'],
    tropes: ['当众被辞退', '扫地出门', '一份没人看好的方案', '行业里的老对手'],
    keywords: ['逆袭', '职场', '打脸', '小人物'],
    opening:
      '林建国被公司当场辞退，理由是「技术老旧」。第二天他带着自己攒了三年的方案走进对家公司，对面坐着的正是昨天辞退他的那位总监。',
    castBias: { leads: 1, villains: 2, supports: 3 },
    beatBias: { 逆袭: 0.35, 打脸: 0.3, 燃: 0.2, 感动: 0.15 },
    pitfalls: '容易写成「一顿嘴炮就赢了」——每次翻身必须付出可见的代价（时间、健康、关系）',
    variants: [
      { key: 'field', label: '行业', values: ['建筑', '广告', '物流', '餐饮', '芯片'] },
      { key: 'setback', label: '起点打击', values: ['被辞退', '被顶替', '被污蔑', '背锅入狱后平反'] },
    ],
  },
  {
    id: 'son-in-law-comeback',
    name: '赘婿逆袭',
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.niche,
    tagline: '上门女婿被全家当成废物，亮底牌那天整栋楼都安静了',
    audience: '30–50 岁男性，看的是「忍辱到最后一次性讨回」',
    thrills: ['打脸', '逆袭', '燃'],
    tropes: ['上门女婿', '吃饭不上桌', '被逼签离婚', '岳母当众羞辱', '真实身份曝光'],
    keywords: ['赘婿', '逆袭', '打脸', '隐藏身份'],
    opening:
      '结婚三年，陈默没上过一次家里的主桌。岳母把离婚协议摔在他面前那天，他擦干净手上的油，给对面打了个电话：那笔三个亿的款，今天到期。',
    castBias: { leads: 1, villains: 3, supports: 3 },
    beatBias: { 打脸: 0.4, 逆袭: 0.3, 燃: 0.2, 感动: 0.1 },
    pitfalls: '2024 年这个题材供给下降约七成，必须换新外壳（职业/地域/关系），照抄老套路会被观众预判',
    variants: [
      { key: 'hiddenPower', label: '隐藏底牌', values: ['集团实际控制人', '军中退役教官', '专利持有人', '一方首富的独子'] },
      { key: 'trigger', label: '爆发点', values: ['离婚协议', '岳父住院', '家族会议', '孩子被欺负'] },
    ],
  },
  {
    id: 'divine-doctor',
    name: '神医下山',
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.niche,
    tagline: '山里学成的年轻医生进城，一手医术把整座城的权贵排成队',
    audience: '25–45 岁男性，看的是「技术流碾压」+ 救人得人情的复利',
    thrills: ['逆袭', '打脸', '感动', '燃'],
    tropes: ['下山寻亲', '医院当众救人', '被误认成骗子', '老专家打脸', '疑难病例'],
    keywords: ['神医', '医术', '打脸', '都市'],
    opening:
      '周宁第一次进城，就在医院门口救回一个已经宣布死亡的老太太。保安要赶他走，老太太的儿子从车里下来，是这家医院最大的股东。',
    castBias: { leads: 1, villains: 2, supports: 3 },
    beatBias: { 逆袭: 0.3, 打脸: 0.3, 感动: 0.25, 燃: 0.15 },
    pitfalls: '医疗细节写不实会立刻掉可信度——只写可观察的症状与处置动作，不编造专业术语',
    variants: [
      { key: 'teacher', label: '师承', values: ['山村老中医', '隐世国手', '军医前辈', '游方道人'] },
      { key: 'ticket', label: '入城理由', values: ['寻亲', '还人情', '查师父死因', '送一封信'] },
    ],
  },
  {
    id: 'rich-system',
    name: '神豪签到系统',
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro'],
    heat: HEAT.rising,
    tagline: '每天签到领钱，钱多到必须想办法花出去，越花越强',
    audience: '18–30 岁男性，看的是「无成本获得 + 花式撒钱」的即时爽',
    thrills: ['逆袭', '搞笑', '打脸'],
    tropes: ['每日签到', '花钱任务', '破产倒计时', '同学会炫富', '被误认成富二代'],
    keywords: ['系统', '神豪', '签到', '搞笑'],
    opening:
      '陈默的银行卡里突然多了十万，系统提示：今日签到奖励。第二天是一百万，第三天系统说，这周你必须花掉三千万，花不完就归零。',
    castBias: { leads: 1, villains: 1, supports: 4 },
    beatBias: { 搞笑: 0.3, 逆袭: 0.3, 打脸: 0.25, 燃: 0.15 },
    pitfalls: '最容易变成流水账炫富——每次花钱必须换回一个具体的东西（人情、线索、打脸机会）',
    variants: [
      { key: 'taskType', label: '任务类型', values: ['签到领钱', '花钱倒计时', '消费返利', '帮人完成任务换积分'] },
      { key: 'weakness', label: '系统限制', values: ['不能告诉别人', '每天限额', '花错方向就扣分', '必须匿名'] },
    ],
  },
  {
    id: 'war-god-return',
    name: '战神归来',
    legacy: true,
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.niche,
    tagline: '边境外的一号人物回乡，只为了护住一个人',
    audience: '25–45 岁男性，看的是「绝对武力 + 绝对护短」',
    thrills: ['燃', '打脸', '逆袭', '感动'],
    tropes: ['归乡', '战友托孤', '旧部来投', '地方恶势力', '身份一露全场跪'],
    keywords: ['战神', '兵王', '护短', '归来'],
    opening:
      '边境撤下来的第五年，秦川第一次回家。妹妹的婚纱照被人撕了，店门口泼着油漆，他蹲下来把照片一张一张捡起来。',
    castBias: { leads: 1, villains: 3, supports: 2 },
    beatBias: { 燃: 0.35, 打脸: 0.3, 逆袭: 0.2, 感动: 0.15 },
    pitfalls: '2024 年下降近六成——不能再靠「亮军牌」解决一切，得有他做不到的事（护不住的人）',
    variants: [
      { key: 'protect', label: '要护的人', values: ['妹妹', '战友遗孤', '母亲', '未婚妻'] },
      { key: 'enemy', label: '对手层级', values: ['地方恶霸', '地产集团', '走私链', '旧部叛徒'] },
    ],
  },
  {
    id: 'hidden-boss',
    name: '隐藏大佬摊牌',
    category: 'urban-comeback',
    channel: 'male',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '公司里最没存在感的那个人，是所有人头上那张网的打结人',
    audience: '22–40 岁职场人，看的是「被低估者一次性翻盘」',
    thrills: ['打脸', '逆袭', '悬疑'],
    tropes: ['透明员工', '被排挤', '大客户点名', '收购方现身', '年会摊牌'],
    keywords: ['大佬', '摊牌', '职场', '打脸'],
    opening:
      '公司裁员名单里排在第一个的是老周，工位最靠里，六年没升过职。第二天董事会换人，新任董事长的第一句话是：老周，你来坐这个位置。',
    castBias: { leads: 1, villains: 2, supports: 3 },
    beatBias: { 打脸: 0.4, 逆袭: 0.25, 悬疑: 0.2, 燃: 0.15 },
    pitfalls: '「装穷」的理由必须站得住（为什么非要藏着），否则观众会觉得降智',
    variants: [
      { key: 'reason', label: '隐藏理由', values: ['考察接班人', '躲家族内斗', '兑现对亡妻的承诺', '等一个叛徒暴露'] },
      { key: 'reveal', label: '摊牌场合', values: ['年会', '董事会', '婚礼', '投标现场'] },
    ],
  },
  {
    id: 'multi-identity',
    name: '马甲掉落',
    category: 'urban-comeback',
    channel: 'all',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '一个人身上挂着五重身份，每掉一层马甲，全场重排一次座次',
    audience: '18–35 岁，男女通吃，看的是「信息差一层层揭开」',
    thrills: ['打脸', '反转', '燃'],
    tropes: ['同一个人不同身份', '被自己人当面羞辱', '大佬互相不认识', '身份同时对撞'],
    keywords: ['马甲', '掉马', '反转', '大佬'],
    opening:
      '林晚在剧组当群演，被主演当众骂哭。制片人赶来赔罪的时候，喊的是她另一个名字——那部戏的最大投资方。',
    castBias: { leads: 1, villains: 2, supports: 4 },
    beatBias: { 打脸: 0.35, 反转: 0.35, 燃: 0.2, 搞笑: 0.1 },
    pitfalls: '马甲太多会失真——最多四层，每层必须有只有这个身份能做的事',
    variants: [
      { key: 'identities', label: '马甲组合', values: ['画家+投资方', '医生+拳手', '编剧+资本方', '程序员+乐队主唱'] },
      { key: 'order', label: '掉落顺序', values: ['先小后大', '最大的一层先掉', '被对手拆穿', '自己主动摊牌'] },
    ],
  },

  /* ============ 豪门婚恋 ============ */
  {
    id: 'sweet-pet',
    name: '甜宠言情',
    legacy: true,
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '冷面的人只对一个人破例，宠得没有道理但处处有细节',
    audience: '18–30 岁女性，看的是「被坚定选择」',
    thrills: ['甜宠', '感动', '搞笑'],
    tropes: ['契约关系', '独占欲', '外人面前护短', '误会三集内解开'],
    keywords: ['甜宠', '总裁', '独宠', '治愈'],
    opening:
      '温晚第一天上班就把老板的咖啡泼在了他八万块的西装上。她准备好被辞退，结果对方只是把外套脱下来递给她：下次别烫到手。',
    castBias: { leads: 2, villains: 1, supports: 4 },
    beatBias: { 甜宠: 0.5, 感动: 0.2, 搞笑: 0.2, 虐心: 0.1 },
    pitfalls: '甜宠的死穴是「为虐而虐」——误会必须三集内解开，反派不能靠降智推动',
    variants: [
      { key: 'setting', label: '相遇场合', values: ['公司入职', '相亲现场', '医院急诊', '雨天打车', '婚礼当伴娘'] },
      { key: 'gap', label: '身份落差', values: ['实习生×总裁', '小医生×投资人', '翻译×外交官', '甜品师×主厨'] },
    ],
  },
  {
    id: 'flash-marriage',
    name: '闪婚先婚后爱',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '认识三天就领证，婚后才发现彼此都藏着不能说的身份',
    audience: '22–38 岁女性，看的是「先有秩序再有感情」的成年人关系',
    thrills: ['甜宠', '反转', '感动'],
    tropes: ['民政局闪婚', '约法三章', '同居磨合', '前任搅局', '身份曝光'],
    keywords: ['闪婚', '先婚后爱', '双强', '都市'],
    opening:
      '沈知意被家里逼着相亲，第三个对象坐下就说：我明天要去民政局，你有空吗。她看了一眼表，说，我下午有空。',
    castBias: { leads: 2, villains: 2, supports: 3 },
    beatBias: { 甜宠: 0.35, 反转: 0.25, 感动: 0.25, 虐心: 0.15 },
    pitfalls: '最容易前五集就把感情写完——留一个「婚后必须共同面对的外部麻烦」当主轴',
    variants: [
      { key: 'reason', label: '闪婚理由', values: ['家里逼婚', '户口与学区', '顶替逃婚的另一半', '公司股权要求'] },
      { key: 'secret', label: '双方秘密', values: ['真实家世', '前一段婚姻', '职业身份', '身体情况'] },
    ],
  },
  {
    id: 'remarriage',
    name: '破镜重圆',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.rising,
    tagline: '分开多年后两人都成了强者，重逢时谁都不肯先低头',
    audience: '28–45 岁女性，看的是「成年人的克制与不甘」',
    thrills: ['虐心', '感动', '甜宠', '反转'],
    tropes: ['旧物', '共同朋友婚礼', '同项目竞标', '孩子/家人牵线', '当年真相'],
    keywords: ['破镜重圆', '久别重逢', '双强', '职场'],
    opening:
      '离婚第六年，林朝在竞标会上遇到前夫。他坐在甲方那一侧，翻到她的方案时停了三秒，只说了一句：这一版比当年那份好。',
    castBias: { leads: 2, villains: 1, supports: 4 },
    beatBias: { 虐心: 0.35, 感动: 0.3, 甜宠: 0.2, 反转: 0.15 },
    pitfalls: '「当年误会」如果站不住，全剧塌——误会必须是一个成年人在当时真的会做的选择',
    variants: [
      { key: 'separation', label: '分开原因', values: ['家族反对', '一场没说清的误会', '一方生病瞒着', '事业与家庭二选一'] },
      { key: 'reunion', label: '重逢场合', values: ['竞标会', '同学会', '医院', '孩子学校', '共同朋友的婚礼'] },
    ],
  },
  {
    id: 'hidden-marriage',
    name: '隐婚夫妻',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '同在一家公司，白天是上下级，晚上是夫妻，谁都不知道',
    audience: '22–35 岁女性，看的是「只有我们知道的秘密」',
    thrills: ['甜宠', '搞笑', '虐心'],
    tropes: ['办公室隐身', '同事起哄', '被迫相亲', '加班同框', '被发现边缘'],
    keywords: ['隐婚', '办公室', '甜宠', '双面'],
    opening:
      '公司规定不许办公室恋情。苏念和她的顶头上司已经结婚两年，每天在电梯里装作不认识，直到新来的实习生当众给她递了一束花。',
    castBias: { leads: 2, villains: 1, supports: 4 },
    beatBias: { 甜宠: 0.4, 搞笑: 0.25, 虐心: 0.2, 反转: 0.15 },
    pitfalls: '隐婚设定最怕「为了藏而藏」——要有一个真实的代价（丢了工作就还不起房贷）',
    variants: [
      { key: 'risk', label: '暴露风险', values: ['公司禁止办公室恋情', '竞业协议', '家族联姻对象在同一层', '前伴侣是同事'] },
      { key: 'tension', label: '主要张力', values: ['同事误会', '晋升竞争', '家人催生', '旧情人回归'] },
    ],
  },
  {
    id: 'fake-heiress',
    name: '假千金换嫁',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '被抱错的真千金回来了，假千金收拾行李那天，才发现自己才是被选中的那个',
    audience: '18–32 岁女性，看的是「身份被剥夺后重新赢回来」',
    thrills: ['虐心', '打脸', '逆袭', '感动'],
    tropes: ['抱错', '认亲', '换嫁', '真假鉴定', '养母偏心'],
    keywords: ['真假千金', '换嫁', '豪门', '认亲'],
    opening:
      '江家真正的女儿回来那天，江晚把自己二十年的东西装进两个箱子。她以为会被赶出去，结果养母把箱子搬回房间，说，这个家姓江，你也姓江。',
    castBias: { leads: 2, villains: 3, supports: 3 },
    beatBias: { 虐心: 0.3, 打脸: 0.3, 逆袭: 0.25, 感动: 0.15 },
    pitfalls: '不要写成单纯受气包——假千金必须有自己的一技之长，靠它在豪门之外站住',
    variants: [
      { key: 'skill', label: '立身本事', values: ['设计', '医术', '厨艺', '鉴定', '谈判'] },
      { key: 'ally', label: '关键盟友', values: ['养母', '爷爷', '未婚夫', '管家', '被救过的人'] },
    ],
  },
  {
    id: 'runaway-pregnant',
    name: '带球跑',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '怀着孩子消失五年，回来时身边多了个缩小版的他',
    audience: '20–35 岁女性，看的是「独自养大 + 重逢对峙」',
    thrills: ['虐心', '甜宠', '感动'],
    tropes: ['五年后', '天才萌宝', '机场重逢', '亲子鉴定', '被抢抚养权'],
    keywords: ['带球跑', '萌宝', '重逢', '总裁'],
    opening:
      '机场到达口，苏晚牵着五岁的儿子往外走。孩子突然停住，指着不远处一群穿西装的人说：妈妈，那个叔叔跟我长一样。',
    castBias: { leads: 2, villains: 2, supports: 3 },
    beatBias: { 虐心: 0.35, 甜宠: 0.3, 感动: 0.2, 打脸: 0.15 },
    pitfalls: '孩子不能只是工具人——萌宝要有自己的诉求，否则观众会觉得在卖萌凑时长',
    variants: [
      { key: 'leaveReason', label: '当年离开原因', values: ['被下药后误会', '家族威胁', '救命钱交易', '以为自己活不过一年'] },
      { key: 'kidTalent', label: '孩子特点', values: ['过目不忘', '嘴特别毒', '会看人', '身体弱但有绝活'] },
    ],
  },
  {
    id: 'workplace-queen',
    name: '职场大女主',
    category: 'romance',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.rising,
    tagline: '不讲爱情也能爽：把被抢走的位置一件一件拿回来',
    audience: '25–45 岁女性，看的是「专业能力被承认」',
    thrills: ['逆袭', '打脸', '燃'],
    tropes: ['成果被抢', '背锅', '带团队出走', '客户点名', '行业大会'],
    keywords: ['大女主', '职场', '女性成长', '逆袭'],
    opening:
      '项目上线庆功宴上，主持人念的是别人的名字。林筱在掌声里把工牌摘下来放在桌上，第二天带着整个小组进了对家公司。',
    castBias: { leads: 1, villains: 2, supports: 4 },
    beatBias: { 逆袭: 0.35, 打脸: 0.3, 燃: 0.2, 感动: 0.15 },
    pitfalls: '不要用「男主来救」解决职场危机——每一次胜利必须是专业能力带来的',
    variants: [
      { key: 'industry', label: '行业', values: ['广告', '医疗器械', '建筑', '投行', '电商'] },
      { key: 'injustice', label: '不公类型', values: ['成果被抢', '性别歧视', '被排挤出项目', '背锅离职'] },
    ],
  },

  /* ============ 古装权谋 ============ */
  {
    id: 'ancient-mansion',
    name: '古代宅斗',
    legacy: true,
    category: 'costume',
    channel: 'female',
    era: 'ancient',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.hot,
    tagline: '深宅里没有刀，但每顿饭都是一场仗',
    audience: '20–40 岁女性，看的是「规则内的高智商博弈」',
    thrills: ['反转', '打脸', '虐心', '悬疑'],
    tropes: ['主母立规矩', '妾室争宠', '嫁妆账本', '庶女翻身', '家法处置'],
    keywords: ['宅斗', '嫡庶', '古代', '权谋'],
    opening:
      '沈家二小姐回府那天，嫡母让人把她的嫁妆箱子抬去库房。她站在院子里没动，只说了一句：箱子上的封条是先帝赐的，谁敢拆。',
    castBias: { leads: 2, villains: 3, supports: 4 },
    beatBias: { 反转: 0.3, 打脸: 0.3, 虐心: 0.25, 悬疑: 0.15 },
    pitfalls: '不要把现代职场话术塞进古代人物嘴里——所有反击必须借礼法、账目、人证',
    variants: [
      { key: 'position', label: '主角处境', values: ['庶女', '回府的嫡女', '寡居少夫人', '续弦主母'] },
      { key: 'lever', label: '翻盘筹码', values: ['嫁妆账本', '宫里的人脉', '一纸婚书', '药方', '先帝旧臣'] },
    ],
  },
  {
    id: 'palace-scheme',
    name: '宫斗权谋',
    category: 'costume',
    channel: 'female',
    era: 'ancient',
    formats: ['standard', 'long'],
    heat: HEAT.rising,
    tagline: '进宫第一天就知道，活下来靠的不是恩宠是信息',
    audience: '22–45 岁女性，看的是「步步为营」',
    thrills: ['反转', '悬疑', '虐心', '打脸'],
    tropes: ['选秀入宫', '位分晋升', '药里下毒', '朝堂与后宫联动', '皇子之争'],
    keywords: ['宫斗', '权谋', '黑莲花', '古代'],
    opening:
      '沈贵妃的宫里从不缺新人。新来的答应答错了一句请安，她笑着免了罪，转头让人把这句话记进了内务府的册子。',
    castBias: { leads: 2, villains: 4, supports: 4 },
    beatBias: { 反转: 0.35, 悬疑: 0.25, 虐心: 0.25, 打脸: 0.15 },
    pitfalls: '宫斗最怕「靠皇帝宠爱解决一切」——真正的胜负手必须落在制度与人证上',
    variants: [
      { key: 'stake', label: '争夺目标', values: ['皇后之位', '太子的归属', '家族平反', '边关兵权'] },
      { key: 'identity', label: '主角身份', values: ['低阶嫔妃', '太医院女官', '和亲公主', '罪臣之女'] },
    ],
  },
  {
    id: 'time-travel-farm',
    name: '穿越种田',
    category: 'costume',
    channel: 'female',
    era: 'ancient',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '带着现代手艺穿成农家女，先让全家吃饱，再让全村跟上',
    audience: '20–40 岁女性，看的是「从无到有的建设感」',
    thrills: ['逆袭', '感动', '搞笑', '甜宠'],
    tropes: ['分家', '灾年', '新作物', '作坊生意', '邻里极品'],
    keywords: ['种田', '穿越', '农家', '发家'],
    opening:
      '苏小满睁眼的时候，家里正在分家，她分到的是一间漏雨的柴房和三亩薄田。她摸了摸怀里那把从现代带来的菜种，笑了。',
    castBias: { leads: 2, villains: 2, supports: 4 },
    beatBias: { 逆袭: 0.35, 感动: 0.25, 搞笑: 0.2, 甜宠: 0.2 },
    pitfalls: '别把现代技术写成万能——每个发明都要过「材料、人手、销路」三关',
    variants: [
      { key: 'skill', label: '现代手艺', values: ['育种', '酿造', '木工', '医术', '制皂'] },
      { key: 'family', label: '家庭处境', values: ['被分家赶出', '寡母带三个孩子', '全家躺平靠她', '被卖去做童养媳'] },
    ],
  },
  {
    id: 'female-general',
    name: '女将军·女帝',
    category: 'costume',
    channel: 'female',
    era: 'ancient',
    formats: ['standard', 'long'],
    heat: HEAT.rising,
    tagline: '披甲上阵那天，朝堂上再没人敢说女子不能领兵',
    audience: '22–40 岁女性，看的是「以实力洗掉所有轻视」',
    thrills: ['燃', '逆袭', '打脸', '感动'],
    tropes: ['代父从军', '边关守城', '朝堂质疑', '军功封赏', '旧部追随'],
    keywords: ['女将军', '大女主', '古代', '军功'],
    opening:
      '父亲战死的军报传到京城那天，谢家十七岁的女儿穿上他的甲。甲太大，她在腰上缠了三层布，走上点将台。',
    castBias: { leads: 2, villains: 3, supports: 3 },
    beatBias: { 燃: 0.35, 逆袭: 0.25, 打脸: 0.25, 感动: 0.15 },
    pitfalls: '不要写成「女扮男装靠恋爱过关」——军功必须是她自己一刀一枪挣的',
    variants: [
      { key: 'path', label: '上位路径', values: ['代父从军', '罪臣之女立功赎罪', '和亲公主反掌兵权', '将门庶女夺爵'] },
      { key: 'obstacle', label: '最大阻力', values: ['朝堂主和派', '副将不服', '粮草被断', '皇帝猜忌'] },
    ],
  },
  {
    id: 'minister-power',
    name: '权臣摄政',
    category: 'costume',
    channel: 'male',
    era: 'ancient',
    formats: ['standard', 'long'],
    heat: HEAT.rising,
    tagline: '从被贬的小吏做到执掌朝纲，全靠一桩一桩案子垒起来的权力',
    audience: '25–45 岁男性，看的是「智斗与权力结构」',
    thrills: ['燃', '反转', '逆袭'],
    tropes: ['科举入仕', '查案立威', '党争站队', '边关军饷', '御前对质'],
    keywords: ['权谋', '朝堂', '男频', '逆袭'],
    opening:
      '新科进士第一天上班就被派去查一桩旧案，卷宗上写着「已结」。他把卷宗翻到最后一页，看见一个被墨涂掉的名字。',
    castBias: { leads: 1, villains: 3, supports: 4 },
    beatBias: { 燃: 0.3, 反转: 0.3, 逆袭: 0.25, 悬疑: 0.15 },
    pitfalls: '权谋不是背台词——每次交锋都要有可核查的筹码（粮、兵、证据、人证）',
    variants: [
      { key: 'entry', label: '入仕起点', values: ['新科进士', '被贬县令', '罪臣之后', '世家旁支'] },
      { key: 'case', label: '开局案子', values: ['军饷失踪', '科举舞弊', '河工贪墨', '旧案翻供'] },
    ],
  },

  /* ============ 年代乡土 ============ */
  {
    id: 'retro-70s-pet',
    name: '七零团宠',
    category: 'retro',
    channel: 'female',
    era: 'retro',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '穿成七十年代家里最不受待见的那个，结果全家都开始护着她',
    audience: '35–60 岁女性，看的是「清贫日子里的暖」与年代还原',
    thrills: ['感动', '逆袭', '甜宠', '搞笑'],
    tropes: ['知青下乡', '粮票布票', '供销社', '重男轻女', '一家人的饭桌'],
    keywords: ['年代', '七零', '团宠', '种田'],
    opening:
      '林小满穿过来的时候，正被亲妈按在炕上骂。她抬手摸了摸头上的包，看见灶台上那半碗留给弟弟的白面，默默把自己的窝头掰成了两半。',
    castBias: { leads: 2, villains: 2, supports: 4 },
    beatBias: { 感动: 0.35, 逆袭: 0.25, 甜宠: 0.2, 搞笑: 0.2 },
    pitfalls: '年代细节一错就出戏——先定死粮票、工分、供销社这三样，别混用不同年代的道具',
    variants: [
      { key: 'role', label: '主角身份', values: ['下乡知青', '回乡知青', '供销社售货员', '赤脚医生', '大队会计'] },
      { key: 'conflict', label: '主要矛盾', values: ['重男轻女', '招工名额', '宅基地', '彩礼换亲'] },
    ],
  },
  {
    id: 'retro-80s-military',
    name: '八零军婚',
    category: 'retro',
    channel: 'female',
    era: 'retro',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '嫁给部队上最冷的那个人，婚后才知道他把所有温柔都留在了家里',
    audience: '35–55 岁女性，看的是「硬汉只对一人软」',
    thrills: ['甜宠', '感动', '虐心'],
    tropes: ['军属院', '探亲假', '军功章', '转业', '家属随军'],
    keywords: ['年代', '八零', '军婚', '甜宠'],
    opening:
      '苏糖被家里塞进部队的相亲会，一眼挑中了最不好惹的那个。介绍人说他不近人情，可他第一次见面就把大衣脱下来裹住了她冻红的手。',
    castBias: { leads: 2, villains: 1, supports: 4 },
    beatBias: { 甜宠: 0.4, 感动: 0.3, 虐心: 0.2, 搞笑: 0.1 },
    pitfalls: '军婚不能只写甜——聚少离多的现实压力要给足，甜才有分量',
    variants: [
      { key: 'post', label: '部队背景', values: ['边防', '工程兵', '通信兵', '军医', '汽车连'] },
      { key: 'gap', label: '关系起点', values: ['相亲闪婚', '娃娃亲', '救命之恩', '组织介绍'] },
    ],
  },
  {
    id: 'retro-90s-business',
    name: '九零下海',
    category: 'retro',
    channel: 'male',
    era: 'retro',
    formats: ['standard', 'long'],
    heat: HEAT.rising,
    tagline: '辞了铁饭碗进城摆摊，第一桶金是用一张火车票换来的',
    audience: '35–55 岁男性，看的是「时代红利 + 敢闯」',
    thrills: ['逆袭', '燃', '感动'],
    tropes: ['南下打工', '批发市场', '第一张订单', '被骗货款', '建厂'],
    keywords: ['年代', '九零', '创业', '下海'],
    opening:
      '陈建国把工作证交上去那天，厂里所有人都说他疯了。他揣着四百块钱和一张南下的火车票，在车厢接口处站了三十个小时。',
    castBias: { leads: 1, villains: 2, supports: 4 },
    beatBias: { 逆袭: 0.35, 燃: 0.3, 感动: 0.2, 打脸: 0.15 },
    pitfalls: '别把创业写成一路开挂——每一笔钱都要有来路，每一次扩张都要有代价',
    variants: [
      { key: 'business', label: '生意', values: ['服装批发', '小家电', '建材', '运输', '餐饮'] },
      { key: 'city', label: '舞台', values: ['深圳', '义乌', '广州', '县城'] },
    ],
  },

  /* ============ 玄幻仙侠 ============ */
  {
    id: 'waste-cultivation',
    name: '废柴修仙',
    category: 'fantasy',
    channel: 'male',
    era: 'fantasy',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.rising,
    tagline: '被判定为无灵根的废物，捡到一本没人看得懂的书',
    audience: '18–35 岁男性，看的是「升级 + 打脸」的确定性快感',
    thrills: ['逆袭', '燃', '打脸'],
    tropes: ['测灵根', '退婚', '试炼', '宗门大比', '秘境'],
    keywords: ['修仙', '废柴', '逆袭', '升级'],
    opening:
      '测灵台上，柳尘的灵根显示为「无」。全场哄笑的时候，他手里那本从垃圾堆捡来的旧书，第一页自己翻开了。',
    castBias: { leads: 1, villains: 3, supports: 3 },
    beatBias: { 逆袭: 0.35, 燃: 0.3, 打脸: 0.25, 悬疑: 0.1 },
    pitfalls: '升级必须有代价，不要写成「捡到宝贝直接无敌」——境界提升要付出资源、伤痛或人情',
    variants: [
      { key: 'cheat', label: '金手指', values: ['旧书', '残缺功法', '一枚锈剑', '能看穿灵气的眼睛'] },
      { key: 'sect', label: '门派处境', values: ['外门杂役', '破落小宗', '被逐出师门', '替兄入门'] },
    ],
  },
  {
    id: 'demon-hunt',
    name: '斩妖升级',
    category: 'fantasy',
    channel: 'all',
    era: 'fantasy',
    formats: ['standard', 'long'],
    heat: HEAT.hot,
    tagline: '杀一只妖夺一门神通，从底层镇魔司小吏杀到神魔战场',
    audience: '18–35 岁男女通吃，看的是「视觉奇观 + 掉落成长」',
    thrills: ['燃', '逆袭', '悬疑'],
    tropes: ['镇魔司', '妖丹', '夺神通', '同行排挤', '妖王苏醒'],
    keywords: ['玄幻', '斩妖', '漫剧', '升级'],
    opening:
      '姜月初加入镇魔司的第一天，分到的是一把豁了口的刀。当晚城南出现大妖，她提着那把刀站在雨里，刀身第一次亮了。',
    castBias: { leads: 1, villains: 3, supports: 3 },
    beatBias: { 燃: 0.4, 逆袭: 0.25, 悬疑: 0.2, 感动: 0.15 },
    pitfalls: '打斗不能只写"一刀斩下"——每场仗要有一个具体的规则（弱点、地形、代价）',
    variants: [
      { key: 'power', label: '夺神通方式', values: ['饮妖血', '收妖丹', '刻妖纹', '记妖名'] },
      { key: 'setting', label: '世界观', values: ['大唐镇魔司', '雪山道观', '海上仙岛', '边关妖城'] },
    ],
  },
  {
    id: 'apocalypse',
    name: '末世求生',
    category: 'fantasy',
    channel: 'all',
    era: 'future',
    formats: ['standard', 'long'],
    heat: HEAT.niche,
    tagline: '末世第七天，别人在抢水，她已经在囤种子',
    audience: '18–32 岁，看的是「先知式准备 + 极端环境下的秩序重建」',
    thrills: ['悬疑', '燃', '逆袭'],
    tropes: ['重生回末世前', '囤货', '基地', '变异', '人性抉择'],
    keywords: ['末世', '囤货', '异能', '生存'],
    opening:
      '末世降临前三天，苏晚把卡里所有的钱换成了种子、盐和汽油。邻居笑她疯了，她只是把门窗钉死，又多买了两箱电池。',
    castBias: { leads: 2, villains: 3, supports: 3 },
    beatBias: { 悬疑: 0.3, 燃: 0.3, 逆袭: 0.25, 感动: 0.15 },
    pitfalls: '末世最容易失去尺度——物资、体力、伤病都要算清楚，否则紧张感全无',
    variants: [
      { key: 'disaster', label: '灾变类型', values: ['极寒', '洪水', '病毒', '虫潮', '磁场紊乱'] },
      { key: 'edge', label: '主角优势', values: ['重生记忆', '囤货仓库', '医疗技能', '一条可靠的地下通道'] },
    ],
  },

  /* ============ 悬疑罪案 ============ */
  {
    id: 'suspense-twist',
    name: '悬疑反转',
    legacy: true,
    category: 'suspense',
    channel: 'all',
    era: 'modern',
    formats: ['micro', 'standard', 'long'],
    heat: HEAT.niche,
    tagline: '每一集给你一个答案，下一秒告诉你答案本身是假的',
    audience: '20–40 岁，看的是「被编剧骗得心服口服」',
    thrills: ['悬疑', '反转'],
    tropes: ['密室', '时间线错位', '不可靠叙述', '双胞胎', '证据反转'],
    keywords: ['悬疑', '反转', '推理', '烧脑'],
    opening:
      '警察在别墅里找到六个人，死者躺在中间。所有人都有不在场证明，只有墙上那幅画的位置，和照片里不一样。',
    castBias: { leads: 2, villains: 2, supports: 4 },
    beatBias: { 悬疑: 0.4, 反转: 0.4, 燃: 0.1, 感动: 0.1 },
    pitfalls: '反转必须能回看找到伏笔——没有铺垫的反转是耍流氓，观众会记仇',
    variants: [
      { key: 'trick', label: '核心诡计', values: ['时间线错位', '身份替换', '集体作伪证', '记忆篡改', '视角欺骗'] },
      { key: 'setting', label: '案发场景', values: ['封闭别墅', '雪山旅馆', '老式公寓', '海岛', '剧组'] },
    ],
  },
  {
    id: 'crime-hunt',
    name: '刑侦追凶',
    category: 'suspense',
    channel: 'male',
    era: 'modern',
    formats: ['standard', 'long'],
    heat: HEAT.rising,
    tagline: '一桩没破的旧案，牵出整条线上的所有人',
    audience: '25–45 岁男性，看的是「抽丝剥茧」与专业感',
    thrills: ['悬疑', '燃', '感动'],
    tropes: ['旧案重启', '法医证据', '线人', '内鬼', '跨省追凶'],
    keywords: ['刑侦', '追凶', '硬汉', '反转'],
    opening:
      '十年前的卷宗被重新调出来时，只有一页不见了。老刑警把那一页的复印件拍在桌上：这案子当年不是破不了，是有人不让破。',
    castBias: { leads: 2, villains: 2, supports: 4 },
    beatBias: { 悬疑: 0.35, 燃: 0.3, 感动: 0.2, 反转: 0.15 },
    pitfalls: '别让警察靠巧合破案——每条线索要么来自证据，要么来自人的行为逻辑',
    variants: [
      { key: 'case', label: '案件类型', values: ['连环失踪', '旧案重启', '跨省诈骗', '边境走私', '纵火'] },
      { key: 'partner', label: '搭档关系', values: ['老带新', '互不信任', '前夫妻', '师徒'] },
    ],
  },

  /* ============ 萌宝亲子 ============ */
  {
    id: 'cute-kid',
    name: '萌宝团宠',
    category: 'family',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.hot,
    tagline: '一个三岁半的崽，把一屋子冷脸大佬训成了护崽队',
    audience: '25–50 岁女性，看的是「无条件被偏爱」',
    thrills: ['甜宠', '搞笑', '感动'],
    tropes: ['认亲', '幼儿园', '被欺负', '全家护短', '亲子鉴定'],
    keywords: ['萌宝', '团宠', '豪门', '亲情'],
    opening:
      '幼儿园第一天，糯糯被小朋友推了一把。她没哭，从书包里掏出一张名片递给老师：这是我爸爸的电话，他说有事打这个。',
    castBias: { leads: 2, villains: 1, supports: 4 },
    beatBias: { 甜宠: 0.35, 搞笑: 0.3, 感动: 0.25, 打脸: 0.1 },
    pitfalls: '幼崽不能只会卖萌——孩子要有自己的目标（找爸爸、保护妈妈、赢得比赛）',
    variants: [
      { key: 'kidEdge', label: '孩子特点', values: ['过目不忘', '嘴毒心软', '力大无穷', '会看人下菜', '天生会算账'] },
      { key: 'family', label: '家庭结构', values: ['单亲妈妈', '豪门认亲', '继父家庭', '祖孙三代'] },
    ],
  },

  /* ============ 民国传奇 ============ */
  {
    id: 'warlord-romance',
    name: '军阀夫人',
    category: 'republic',
    channel: 'female',
    era: 'republic',
    formats: ['standard', 'long'],
    heat: HEAT.niche,
    tagline: '被强娶进督军府那天，她带了一箱书和一把剪刀',
    audience: '25–45 岁女性，看的是「旗袍与枪」的张力',
    thrills: ['虐心', '反转', '燃', '甜宠'],
    tropes: ['强娶', '督军府', '洋场', '家国大义', '旧情人归来'],
    keywords: ['民国', '军阀', '虐恋', '传奇'],
    opening:
      '花轿抬进督军府的时候，沈如晦正在擦枪。他抬眼看新娘自己掀了盖头，然后从袖子里抽出一把剪刀。',
    castBias: { leads: 2, villains: 3, supports: 3 },
    beatBias: { 虐心: 0.35, 反转: 0.25, 燃: 0.2, 甜宠: 0.2 },
    pitfalls: '民国不是只有旗袍和留声机——军阀混战、租界、报馆这些背景要落到具体事件上',
    variants: [
      { key: 'role', label: '主角身份', values: ['女学生', '报馆记者', '戏班名角', '留洋医生', '落魄千金'] },
      { key: 'warlord', label: '男主身份', values: ['少帅', '督军', '军需官', '地下党', '洋行买办'] },
    ],
  },

  /* ============ 校园娱乐 ============ */
  {
    id: 'campus-comeback',
    name: '校园学霸逆袭',
    category: 'campus-show',
    channel: 'all',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '被当成差生坐了三年最后一排，高考前三个月换了个人',
    audience: '15–25 岁，看的是「成绩单上的翻身」',
    thrills: ['逆袭', '打脸', '燃', '感动'],
    tropes: ['分班', '竞赛', '家长会', '被冤枉作弊', '保送名额'],
    keywords: ['校园', '学霸', '逆袭', '青春'],
    opening:
      '高三第一次模考，全校倒数第一的座位空着。班主任推门进来，看见那个位置上坐着一个陌生的女生，桌角摆着一张满分的答题卡。',
    castBias: { leads: 2, villains: 2, supports: 4 },
    beatBias: { 逆袭: 0.35, 打脸: 0.25, 燃: 0.2, 感动: 0.2 },
    pitfalls: '别把学习写成玄学——提分要靠具体方法（错题、专项、时间表），观众要看过程',
    variants: [
      { key: 'reason', label: '逆袭动因', values: ['家里出事', '被当众羞辱', '替人背锅', '重生回高三'] },
      { key: 'subject', label: '突破口', values: ['数学', '物理竞赛', '英语', '作文'] },
    ],
  },
  {
    id: 'entertainment-comeback',
    name: '娱乐圈黑红翻红',
    category: 'campus-show',
    channel: 'female',
    era: 'modern',
    formats: ['micro', 'standard'],
    heat: HEAT.rising,
    tagline: '全网都在骂她，她反手把黑料变成作品',
    audience: '16–32 岁女性，看的是「舆论反转 + 事业线」',
    thrills: ['逆袭', '打脸', '搞笑', '燃'],
    tropes: ['塌房', '热搜', '公关战', '综艺翻盘', '粉丝倒戈'],
    keywords: ['娱乐圈', '黑红', '逆袭', '顶流'],
    opening:
      '热搜第一是她的名字，配文两个字：滚出。林知夏把手机放下，打开录音棚的门，说，那首歌我今天就发。',
    castBias: { leads: 2, villains: 3, supports: 3 },
    beatBias: { 逆袭: 0.3, 打脸: 0.3, 搞笑: 0.2, 燃: 0.2 },
    pitfalls: '别把翻红写成「靠一个贵人」——作品、路人盘、数据三条线要同时走',
    variants: [
      { key: 'scandal', label: '黑料类型', values: ['被造谣耍大牌', '剪辑陷害', '合约纠纷', '替人背锅'] },
      { key: 'comeback', label: '翻盘方式', values: ['一首歌', '一部小成本剧', '综艺真性情', '直播带货翻身'] },
    ],
  },
]);

/* ------------------------------------------------------------------ */
/* 查询与拼装                                                          */
/* ------------------------------------------------------------------ */

export const GENRE_BY_ID = new Map(GENRES.map((g) => [g.id, g]));
export const GENRE_BY_NAME = new Map(GENRES.map((g) => [g.name, g]));
export const DEFAULT_GENRE_ID = 'urban-rebirth-revenge';

/** 允许前端传 id、传旧的中文名、或者完全不传（回落到默认题材）。
 *  未知 id 也回落默认：前端 localStorage 里可能存着上一版的题材 id，
 *  返回 null 会让调用方到处判空，不如宽容一点，题材错了用户在界面上立刻能看见。 */
export function genreById(id) {
  const fallback = GENRE_BY_ID.get(DEFAULT_GENRE_ID);
  if (!id) return fallback;
  return GENRE_BY_ID.get(String(id)) ?? GENRE_BY_NAME.get(String(id)) ?? fallback;
}

/** 前端选择器数据：大类分组 + 扁平清单（不带 opening/pitfalls 这些长文本，省流量） */
export function genreCatalog() {
  return {
    categories: GENRE_CATEGORIES,
    channels: CHANNELS,
    eras: ERAS,
    formats: FORMATS,
    thrills: THRILLS,
    hookTypes: HOOK_TYPES,
    items: GENRES.map((g) => ({
      id: g.id,
      name: g.name,
      legacy: Boolean(g.legacy),
      category: g.category,
      channel: g.channel,
      era: g.era,
      formats: g.formats,
      heat: g.heat,
      tagline: g.tagline,
      keywords: g.keywords,
    })),
  };
}

/** 组合空间大小：同题材能被拆出多少种不同开局（用于文档与前端提示） */
export function variantSpace(genre) {
  if (!genre) return 1;
  const dims = genre.variants ?? [];
  return dims.reduce((n, d) => n * Math.max(1, d.values.length), 1);
}

/**
 * 挑一组差异化变体。
 * seed 传进来（一般是「上次用的组合序号 + 1」），保证同一题材连续生成时不会撞同一组；
 * 不传就按时间随机。
 */
export function pickVariant(genre, seed) {
  const dims = genre?.variants ?? [];
  if (!dims.length) return {};
  const space = variantSpace(genre);
  const n = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) % space : Math.floor(Math.random() * space);
  const picked = {};
  let rest = n;
  for (const d of dims) {
    const len = Math.max(1, d.values.length);
    picked[d.key] = d.values[rest % len];
    rest = Math.floor(rest / len);
  }
  return picked;
}

/** 变体组合的人话描述，进提示词与前端回显 */
export function describeVariant(picked) {
  return Object.entries(picked ?? {})
    .map(([k, v]) => `${k}：${v}`)
    .join('；');
}

/**
 * 题材坐标块：注入 story 阶段系统提示。
 * 只写「题材特有的东西」，短剧常识那套仍由 CRAFT_RULES 统一给，不重复。
 */
export function genreBlock(genre, { variant, avoid } = {}) {
  if (!genre) return '';
  const cat = GENRE_CATEGORIES.find((c) => c.id === genre.category);
  const era = ERAS.find((e) => e.id === genre.era);
  const ch = CHANNELS.find((c) => c.id === genre.channel);
  const v = variant && Object.keys(variant).length ? `\n- 本次差异化设定（必须用，别绕开）：${describeVariant(variant)}` : '';
  const avoidList = (avoid ?? []).filter(Boolean);
  const avoidBlock = avoidList.length
    ? `\n\n【禁止复用】（这些是本人已经写过的，换个新的，一个都不许撞）\n${avoidList.map((x) => `- ${x}`).join('\n')}`
    : '';
  return `【题材坐标】
- 题材：${genre.name}（${cat?.name ?? '未分类'}）
- 定位：${genre.tagline}
- 受众：${ch?.label ?? ''}，${genre.audience}
- 时代与美术：${era?.label ?? ''}（${era?.hint ?? ''}）
- 本题材的爽点优先序：${genre.thrills.join(' > ')}（第一个必须是全剧的主爽点）
- 可用的剧情桥段池（挑 3–5 个用，不要全塞）：${genre.tropes.join('、')}
- 标签：${genre.keywords.join(' / ')}
- 参考开篇（**只学口吻与信息密度，剧情必须换**）：${genre.opening}
${v}
- 这个题材最容易翻车的地方：${genre.pitfalls}${avoidBlock}`;
}

/** 人物配比的提示词片段：把 castBias 翻成人话，避免模型自己乱分配 */
export function castBiasText(genre) {
  if (!genre?.castBias) return '';
  const { leads = 2, villains = 2, supports = 4 } = genre.castBias;
  return `主角组 ${leads} 位、反派 ${villains} 位、配角 ${supports} 位（共 ${leads + villains + supports} 位左右），不要平均分配戏份`;
}

/** 大纲阶段的爽点配比：把 beatBias 翻成「每 10 集大致怎么排」 */
export function beatBiasText(genre, episodes = 40) {
  if (!genre?.beatBias) return '';
  const rows = Object.entries(genre.beatBias)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} 约 ${Math.round(v * 100)}%`);
  const major = genre.thrills[0];
  const every = episodes >= 60 ? 8 : 6;
  return `爽点配额：${rows.join('、')}；每 ${every} 集必须有一个「${major}」大爆点，第 1 集就给第一个`;
}

/**
 * 题材指纹：用于「同一题材不重样」的记账。
 * 组合了题材 id + 变体组合，落在 project.json 里，下次生成前比对。
 */
export function genreFingerprint(genreId, variant, title = '') {
  const v = Object.entries(variant ?? {}).map(([k, val]) => `${k}=${val}`).sort().join('|');
  return `${genreId}#${v}${title ? `@${title}` : ''}`;
}
