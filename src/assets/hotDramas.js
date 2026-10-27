/*
 * 爆款榜单 · 剧目库（真实数据）
 *
 * 为什么单独抽一个文件：榜单以前是「样本库」按种子随机拼出来的占位剧名
 * （「XX涅槃」之类），没有链接、没有海报，对标分析拿它当基准其实等于拿
 * 假数据当真。现在换成网上真实可查的剧目，集中放在这一个数组里——
 * 以后榜单更新，只改这个文件，不动任何逻辑与界面。
 *
 * 数据从哪来、怎么核的（2026-10-19 逐条实测）：
 *   榜单 = 红果短剧总榜 TOP20 的前 10（榜单日期 2026-10-01）
 *   排名/剧名/标签/热度：塔猴 TOP20 汇总 + 电影界 10 月总榜，两个独立来源一致。
 *   官方播放页：红果官网 hongguoduanju.com/player/<series_id>，
 *     10 条全部定位到官方 series_id，每条实测 HTTP 200 且页面渲染出该剧剧名。
 *     第 9 名《蒙冤二十五年》是 AI 短剧，不在真人剧榜里，靠站内搜索页定位
 *     （它的详情页也没进 sitemap，所以按 ID 时间戳扫全站没扫到，别再走那条路）。
 *   海报：红果官方图片 CDN（*.novel.byteimg.com/novel-pic/...），
 *     10 条实测匿名可访问（不带 referer 也 200 image/jpeg，无防盗链）。
 *   集数与简介：全部取自官方详情页的 episode_cnt / series_intro。
 *
 * 哪些字段是真核实过的、哪些不是（别猜、别编）：
 *   - 排名 / 剧名 / 题材标签 / 热度：两来源一致，可查。
 *   - 官方播放页 / 海报 / 集数 / 简介：来自红果官方站点，10/10 逐条实测。
 *   - 一句话推荐语：全部依据官方剧情简介压缩（pitchSource='source'）。
 *     注意《蒙冤二十五年，归来举世皆惊》：网传「蒙冤入狱二十五年后复仇」
 *     是自媒体误述，官方简介与短剧百科均为「父亲归来 + 退婚护尊严」，
 *     本库按官方口径写。
 *   - 集数以红果官方 episode_cnt 为准：《蒙冤二十五年》官方 70 集、
 *     短剧百科写 71 集，这种 1 集的差异按官方口径记。
 *
 * 更新方式：改这个数组即可。改完请同步 updatedAt，并跑
 *   npm run selftest   （会校验条数、排名、链接协议、海报协议、必填字段）
 */

/** 榜单元信息：界面要显示「这份数据哪来的、什么时候的、还差什么」 */
export const HOT_BOARD_META = Object.freeze({
  board: '红果短剧总榜 TOP20（2026 年 10 月榜）',
  dataDate: '2026-10-01',
  updatedAt: '2026-10-19',
  platform: '红果短剧',
  sources: [
    { name: '塔猴 · 2026年10月红果短剧三大榜单 TOP20 汇总', url: 'https://www.tahou.com/article/218760893790331909' },
    { name: '电影界 · 红果 10 月总榜：大唐憨婿 8264 万登顶', url: 'https://www.dianyingjie.com.cn/2026/1004/406474.shtml' },
    { name: '红果短剧官网 · 真人剧热播榜（官方播放页与海报来源）', url: 'https://hongguoduanju.com/rank/hot-real-drama' },
  ],
  verifyNote: '排名/剧名/标签/热度由两个独立来源交叉核对；官方播放页、海报、集数全部取自红果官网（10/10），2026-10-19 逐条实测 HTTP 200 且无防盗链。',
  todos: [
    '热度与排名是 2026-10-01 榜单的快照，红果站内口径每天在变（如《蒙冤二十五年》已回落到 5000 万档）；更新榜单时以新一期榜单为准，别拿旧热度当现状。',
    '集数取红果官方 episode_cnt，与第三方站点可能差 1 集（如《蒙冤二十五年》官方 70 集 / 短剧百科 71 集）；更新时以官方详情页为准。',
  ],
});

/** 红果站内搜索入口：按剧名拼装的官方搜索页（不是详情页，用于找同剧其它季） */
const hgSearch = (title) => `https://hongguoduanju.com/search?keyword=${encodeURIComponent(title)}`;
/** 红果官方播放页 */
const hgPlayer = (sid) => `https://hongguoduanju.com/player/${sid}`;

/**
 * 榜单条目原始事实。字段含义：
 *   rank         榜单排名（真实排名，筛选后不重排）
 *   title        剧名（与来源一致，含季数）
 *   genre        主题材（取标签首项，供「题材分布」统计）
 *   tags         官方题材标签
 *   pitch        一句话推荐语
 *   pitchSource  'source' = 压缩自官方剧情简介；'editorial' = 按剧名+标签撰写
 *   platform     播放平台
 *   heat         热度数值（万，榜单口径）
 *   heatText     热度原文
 *   episodes     集数（官方 episode_cnt；null = 未核实）
 *   synopsis     剧情梗概（官方 series_intro）
 *   url          可点击链接：红果官方播放页（缺官方页时用可靠资讯页）
 *   urlNote      链接说明（标注是不是官方页）
 *   playUrl      红果站内搜索入口（拼装）
 *   cover        宣传海报直链（官方 CDN）
 *   coverNote    海报状态说明（空 = 官方图，可放心用）
 */
export const HOT_DRAMAS = Object.freeze([
  {
    rank: 1,
    title: '大唐憨婿之我姐姐是太子妃第三季',
    genre: '宫廷',
    tags: ['宫廷', '古代'],
    pitch: '太子妃遭暗算命悬一线，只会造细盐造纸的「憨子」苏昊提双锤杀穿长安，转头又被李世民抓住手求他救皇后。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 8264,
    heatText: '8264万',
    episodes: 180,
    synopsis: '太子妃遭暗算命悬一线，苏昊提双锤杀穿长安，逼得魏王逃入皇宫、世家割地赔款。可风波未平，长孙皇后突然病危，李世民竟抓住苏昊的手求他救命。一个养马出身、只会造细盐纸张的「憨子」，真能救大唐皇后吗？',
    url: hgPlayer('7689482965906099262'),
    urlNote: '红果官方播放页（series_id 7689482965906099262）',
    cover: 'https://p3-novel.byteimg.com/novel-pic/93e3c074a663259ed98e2a41ebe3047a~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 2,
    title: '绿意萌熹：蛙系萌娃闹翻忧郁老爸',
    genre: '萌宝',
    tags: ['萌宝', '都市', '豪门'],
    pitch: '福利院长大、被豪门寻回的两岁萌娃熹宝，用古灵精怪一点点撬开重度抑郁父亲封闭的心。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 7370,
    heatText: '7370万',
    episodes: 117,
    synopsis: '在福利院长大的两岁萌娃熹宝被豪门霍家寻回，以古灵精怪的性格逐渐治愈患有重度抑郁症、封闭自我的父亲霍时舟，同时在霍家众人的宠爱下适应新家庭，化解潜在威胁，最终与家人建立深厚情感。',
    url: hgPlayer('7686812666374933566'),
    urlNote: '红果官方播放页（series_id 7686812666374933566）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/3f8d79a4f1a096cbd9564c9152b9cabd~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 3,
    title: '聚宝仙盆之杂灵根才是真BOSS第十二季',
    genre: '玄幻',
    tags: ['玄幻', '修真', '逆袭', '异界', '3D'],
    pitch: '杂役弟子贺平生靠一只聚宝盆从下界杀进仙界，在佛玄之争与生死线里逆天改命。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 7221,
    heatText: '7221万',
    episodes: 222,
    synopsis: '杂役弟子贺平生，身怀聚宝盆，从下界一路杀入仙界。他得魔道传承，斩天昴仙王，在金羽之会顶名夺魁，却卷入佛门与玄门之争。为寻一魂双身的妻子乔慧珠与温不晚，他闯入天佛大会，被种下生死线，遭大罗金仙围杀，重伤遁入紫薇天。',
    url: hgPlayer('7686894628578020414'),
    urlNote: '红果官方播放页（series_id 7686894628578020414）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/151cc93a92488906a23ce028aece2c81~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 4,
    title: '满院亲戚全是上古大妖第四季',
    genre: '奇幻',
    tags: ['奇幻', '修真', '年代'],
    pitch: '九尾狐带四岁儿子搭绿皮火车寻夫安家，一众上古大妖伪装成亲戚落户砖窑厂，男主却拿科学解释他们的妖力。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 7029,
    heatText: '7029万',
    episodes: 155,
    synopsis: '九尾狐涂山瑶为修复濒碎结界、养育族人，带四岁儿子涂山小宝寻纯阳功德之夫霍云铮。母子搭绿皮火车智取人贩，一路借采药、黑市交易攒安家钱。霍云铮身为救援总队长，对体弱神秘的母子心生护持，领证同住。一众精怪来投奔，夫妻联手击退凶兽。',
    url: hgPlayer('7688558312157088793'),
    urlNote: '红果官方播放页（series_id 7688558312157088793）',
    cover: 'https://p3-novel.byteimg.com/novel-pic/1fbc591036bc1ba401e0cd2eb4b62d5e~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 5,
    title: '二嫁有喜',
    genre: '爱情',
    tags: ['爱情', '古风', '女性成长', '大女主'],
    pitch: '嫁入侯府七年无子被丈夫动了另娶的心思，她果断和离，三天后二嫁鳏夫，才发现这次是被捧在手心里。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6951,
    heatText: '6951万',
    episodes: 77,
    synopsis: '江芝嫁给永宁侯谢景渊七年始终无所出，谢景渊起了另娶他人的心思，江芝撞破后果断选择和离。三天后江芝二嫁鳏夫周晋，婚后却发现周晋虽然外面冷漠，却总在不经意间展现对她的敬重和爱护。江芝动了真感情，谢景渊后悔不已，但为时已晚。',
    url: hgPlayer('7687919221593885758'),
    urlNote: '红果官方播放页（series_id 7687919221593885758）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/c627eba55699a159244fcfb404713340~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 6,
    title: '乡下来的掌上明珠',
    genre: '萌宝',
    tags: ['萌宝', '异能', '都市', '豪门', '3D'],
    pitch: '能听懂动物心声的乡下女孩呦呦回归豪门，靠小动物们帮忙一次次化解危机，慢慢赢回家人的疼爱。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6708,
    heatText: '6708万',
    episodes: 142,
    synopsis: '呦呦从小在乡下长大，拥有听懂动物心声的特殊能力。回归裴家后，面对家庭内部的偏见与矛盾，她始终善良纯粹。凭借小动物们的帮助，一次次化解危机，用真诚温暖身边的人，慢慢赢得家人的理解与疼爱。',
    url: hgPlayer('7686433880127048728'),
    urlNote: '红果官方播放页（series_id 7686433880127048728）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/ea9c69f4f3b6a1088c6c82dbb4ea1e07~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 7,
    title: '家有五女，穿越来的他连夜搞事业啦',
    genre: '剧情',
    tags: ['剧情', '穿越', '逆袭', '古代'],
    pitch: '出个差就被砸穿越，怀里多了个刚出生的女儿——还是第五个。家徒四壁，他只能连夜搞事业养五朵小棉袄。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6698,
    heatText: '6698万',
    episodes: 1000,
    synopsis: '秦朗不过是出个差的功夫，因为好奇心过重凑了个热闹，不小心被砸中，穿越到了古代。还没反应过来，怀里就被塞了个刚出生的孩子，说是他的女儿，还是第五个。家里家徒四壁、父母偏心、妻女嗷嗷待哺，为了让五个小棉袄过上好日子，秦朗只能连夜搞事业。',
    url: hgPlayer('7688646466708966462'),
    urlNote: '红果官方播放页（series_id 7688646466708966462）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/6be6de7b80ddc5cb6df225902f3d5823~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 8,
    title: '穿越六零之我在山洞闷声发家',
    genre: '种田',
    tags: ['种田', '穿越', '异能', '逆袭', '年代'],
    pitch: '特种兵魂穿物资匮乏年代，被锁柴房濒死时觉醒灵田空间，断亲搬进山洞，靠双手在艰苦岁月里攒出一个家。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6641,
    heatText: '6641万',
    episodes: 157,
    synopsis: '现代特种兵魂穿物资匮乏的年代，成为受尽原生家庭苛待的秦天。被锁柴房濒死之际觉醒灵田空间，手握灵泉沃土。他当众撕破家人的虚伪面目，立下文书断亲，搬去山脚荒洞自立门户，进山狩猎、种植作物，在艰苦岁月里奋斗出属于自己的温暖小家。',
    url: hgPlayer('7688666572499471422'),
    urlNote: '红果官方播放页（series_id 7688666572499471422）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/65a4cd5682095c7eeeec82a0c9c172a6~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 9,
    title: '蒙冤二十五年，归来举世皆惊',
    genre: '剧情',
    tags: ['剧情', '都市'],
    pitch: '订婚宴上消失二十五年的父亲突然归来，未婚妻一家嫌弃他的来历，他当场退婚，把父亲的尊严护了回来。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6596,
    heatText: '6596万',
    episodes: 70,
    synopsis: '普通打工人陈志远即将和相恋多年的女友林倩订婚，消失二十五年的父亲陈国栋终于归来。没人知道，所谓消失只是绝密科研项目身份的掩护。订婚宴风云突变，林倩及其父母得知陈国栋经历后心生嫌弃，陈志远不愿家人受辱，毅然选择退婚。',
    url: hgPlayer('7684559889913351193'),
    urlNote: '红果官方播放页（series_id 7684559889913351193，AI 短剧，不在真人剧榜内）',
    cover: 'https://p3-novel.byteimg.com/novel-pic/8c444fb5e6f34ea7c67354e3aa716364~tplv-shrink:640:0.image',
    coverNote: '',
  },
  {
    rank: 10,
    title: '谁让这个文盲修仙的第四季',
    genre: '玄幻',
    tags: ['玄幻', '穿越', '修真', '逆袭', '异界', '3D'],
    pitch: '不识字的陈极靠看图逆修功法，从血神古地杀出、接下传承，回头带着一群人守住摇摇欲坠的青云宗。',
    pitchSource: 'source',
    platform: '红果短剧',
    heat: 6445,
    heatText: '6445万',
    episodes: 175,
    synopsis: '陈极一行人在血神古地获机缘，陈极突破金丹大圆满，得血金万象轮传承。返回玄天大陆后宗门易主、前辈失踪，他们加入危在旦夕的青云宗，收服尸傀宗，勇闯琼宵圣地夺得血灵晶骨。古帝宫殿现世，众人闯过幻境试炼赢得传承，归来携手共抗强敌守护青云宗。',
    url: hgPlayer('7688372772879223870'),
    urlNote: '红果官方播放页（series_id 7688372772879223870）',
    cover: 'https://p6-novel.byteimg.com/novel-pic/8866a98ff439c7f103294bc57c4b7bcd~tplv-shrink:640:0.image',
    coverNote: '',
  },
]).map((d) => Object.freeze({ ...d, playUrl: hgSearch(d.title) }));

/** 题材下拉：就直接从榜单里现取，不另维护一份（免得两边对不上） */
export function hotGenres() {
  return [...new Set(HOT_DRAMAS.map((d) => d.genre))].sort();
}
