import { frameworkBeatSeq, frameworkSpringPlan, DEFAULT_FRAMEWORK_ID } from '../assets/storyFrameworks.js';
import { RISK_PATTERNS as OUTLINE_RISKS } from '../engine/outline.mjs';

/* ============================================================
   本地样本引擎（组合式生成）
   为什么不用固定剧本：同一个项目反复生成不该总是同一部。
   做法：题材词库 × 人物/场景/冲突/钩子池 × 句子骨架，由种子随机组合。
   种子来自项目参数（题材/集数/时长/创意），同参数结果稳定可复现，
   换任何一项就是另一部——接真 API 前，功能链路本身是活的。
   ============================================================ */

/* ---------------- 确定性随机 ---------------- */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Bag {
  constructor(rnd) { this.rnd = rnd; }
  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  /** 不重复取 n 个 */
  take(arr, n) {
    const pool = [...arr];
    const out = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]);
    return out;
  }
  int(lo, hi) { return lo + Math.floor(this.rnd() * (hi - lo + 1)); }
}

/* ---------------- 题材词库 ---------------- */
const SURNAMES = '沈陆顾苏林叶程季谢秦白许韩周吴郑梁何宋罗高'.split('');
const GIVEN_F = '知微晚晴疏桐清宴惊鸿眠星栖迟望舒予安南乔砚秋翎月'.split('');
const GIVEN_M = '行远既白折蔺照野临渊辞戍砚舟辞舟赴凛川观澜峙岑既明'.split('');

const GENRE_PACKS = {
  '女频逆袭': {
    heads: ['下堂', '庶女', '前妻', '替嫁', '和离'],
    leads: ['被退婚的将门遗孤', '替嫁进侯府的庶女', '产婆手里活下来的寡妇', '被家族除名的女账房', '顶替姐姐入宫的绣娘'],
    rivals: ['当众撕毁婚书的世子', '抢走功劳的嫡姐', '迟迟不肯放手的婆母', '把女儿当货物的生父', '处处压她一头的贵女'],
    helpers: ['毒舌却护短的老嬷嬷', '身世成谜的车夫', '欠她一条命的游医', '不说话只做事的暗卫', '看似纨绔的王府次子'],
    scenes: ['正厅', '祠堂', '后院柴房', '渡口码头', '绣楼', '马球场', '药铺', '城门口'],
    props: ['半块玉佩', '一封血书', '褪色的绣帕', '前夫留下的账册', '母亲的旧簪'],
    conflicts: ['当众被撕毁婚书', '救命钱被挪用', '功劳被至亲顶替', '被诬陷与人私通', '唯一的靠山倒台'],
    hooks: ['撕破的婚书里裹着另一份字据', '她袖中藏着当年救驾的凭证', '所有人都以为她死了', '退婚背后是有人要灭口', '她才是真正该继承爵位的人'],
    payoffs: ['当众验明正身', '一笔勾销旧账', '让诬陷者反坐', '拿回本该属于她的', '一句句把罪名驳回去'],
    cliffhangers: ['门外传来熟悉的脚步声', '那封信的落款出现了第二个名字', '火光里有人喊出了她的旧名', '刚到手的东西转眼不见了', '本该在场的人提前知道了消息'],
    styleHint: '古风',
  },
  '悬疑': {
    heads: ['渡口', '夜航', '旧案', '第三个人', '消失的'],
    leads: ['接手旧案的年轻法医', '回到故乡的刑警', '收到匿名信的档案管理员', '继承老宅的律师', '每晚同一时刻醒来的女人'],
    rivals: ['始终微笑的物业管理员', '过度热情的居委会主任', '拒绝配合的船务公司老板', '记忆出现缺页的幸存者', '抢先结案的上级'],
    helpers: ['退休的老档案员', '暗访的实习记者', '懂行的码头工人', '不善言辞的绘图师', '只认证据的技侦'],
    scenes: ['渡船船舱', '派出所档案室', '老宅阁楼', '码头仓库', '医院走廊', '桥洞下', '面馆后厨', '派出所门口'],
    props: ['旧皮箱', '缺页的航海日志', '带缺口的钥匙', '匿名包裹', '半张合影'],
    conflicts: ['证物不翼而飞', '唯一目击者改口', '尸体与档案对不上', '监控偏偏缺了一段', '报案人先一步死了'],
    hooks: ['每个死者袖口都绣着同一个字', '案发时刻船根本不在港', '第三个人的指纹出现在不该出现的地方', '十年前的结案报告是伪造的', '她每晚梦见的巷子真实存在'],
    payoffs: ['当众拆穿不在场证明', '一份旧录像推翻结论', '凶手是自己露出马脚的', '关键证词被完整录下', '隐藏的关系网浮出水面'],
    cliffhangers: ['电话那头只剩下呼吸声', '刚封存的档案室进了水', '邻居的门在凌晨三点开了', '下一页档案上写着她的名字', '船老大说那晚船上多了一个人'],
    styleHint: '悬疑',
  },
  '都市': {
    heads: ['外卖', '代驾', '保洁', '程序员', '实习生'],
    leads: ['被裁员的全职妈妈', '白天送外卖晚上考研的男人', '背着一身债的房产中介', '被降职的部门主管', '从小城来的第一代白领'],
    rivals: ['抢单还抢功的同事', '只认业绩的总监', '笑里藏刀的合伙人', '把加班当福报的领导', '处处占她便宜的二房东'],
    helpers: ['同样艰难的合租室友', '退休后仍在跑单的老骑手', '敢说真话的实习生', '欠着人情的财务', '只看合同条款的律师'],
    scenes: ['合租房客厅', '写字楼消防通道', '深夜便利店', '医院缴费窗口', '中介门店', '地下车库', '外卖取餐点', '劳动仲裁大厅'],
    props: ['未结清的账单', '被裁时的纸箱', '一份没签字合同', '诊疗单', '孩子的学费通知'],
    conflicts: ['工资被无故克扣', '房租突然暴涨', '报销单被驳回', '客户当场翻脸', '孩子学校来电'],
    hooks: ['她的工位在裁员名单公布前就被清空了', '那笔救命钱在到账前被转走', '所有人都说不可能的事她做到了', '欺负她的人正是当年顶替者', '一张化验单改变了所有安排'],
    payoffs: ['当众拿出完整的证据链', '让对方在规则里认输', '把该拿的钱一分不少拿回', '让旁观者主动作证', '用专业能力当场翻盘'],
    cliffhangers: ['手机弹出一条到账短信', '电梯门开时外面站着谁', '刚签的字被人复印带走', '孩子在学校门口喊了一个称呼', '凌晨的群里弹出一条@全员'],
    styleHint: '都市',
  },
  '古风': {
    heads: ['公主', '将军', '书生', '戏班', '镖局'],
    leads: ['替兄从军的少女', '被贬还乡的女史官', '戏班里的武生', '接管镖局的少当家', '失忆的公主'],
    rivals: ['把持朝政的国舅', '通敌的副将', '抢徒的别班班主', '劫镖又劫人的山匪', '取而代之的假公主'],
    helpers: ['瞎眼却懂棋的老琴师', '沉默的铁匠', '会说蕃语的小童', '退役的老镖师', '道观里算卦的坤道'],
    scenes: ['军营帅帐', '戏台后台', '镖局院子', '皇城角楼', '边关烽火台', '渡口茶馆', '山神庙', '宫道'],
    props: ['断裂的兵符', '师父遗谱', '未寄出的家书', '染血的戏服', '半幅地图'],
    conflicts: ['兵符被盗', '师父横死', '镖银失踪', '身份被顶替', '部下集体倒戈'],
    hooks: ['她的裹胸布在军医手里露了馅', '遗谱最后一页写着叛徒的名字', '那封信的笔迹与圣上一般无二', '戏台上的死阵暗合真实兵法', '烽火台点燃的方向本该无敌军'],
    payoffs: ['阵前亮明真实身份', '一曲旧谱让叛将自乱', '当众验出兵符真伪', '把伪证摔在堂上', '单枪匹马闯营擒王'],
    cliffhangers: ['帅帐外传来整齐的脚步声', '琴弦在一处齐断', '烽火第二次亮起时方向变了', '她的手按上了剑柄却停住', '帐帘掀起，来人是她的旧识'],
    styleHint: '国风',
  },
  '男频战神': {
    heads: ['战神', '龙王', '归来', '五年', '狂婿'],
    leads: ['被当成废物的上门女婿', '卸甲归田的年轻战神', '顶罪入狱五年的男人', '被逐出家族的长子', '隐姓埋名的武道高手'],
    rivals: ['捧高踩低的岳父岳母', '篡夺功劳的义弟', '赶尽杀绝的世家', '当着女儿面赶人的妻族', '觊觎他产业的商会'],
    helpers: ['始终相信他的妻子', '拖着病体等他归来的老部下', '市井里讲义气的兄弟', '只看实力的裁判', '慧眼识人的老人'],
    scenes: ['家宴大厅', '岳家小区门口', '旧部集结的码头', '武道擂台', '医院病房', '祠堂', '商会年会', '机场到达厅'],
    props: ['褪色的军牌', '当年的任命书', '一枚旧勋章', '妻子缝的护腕', '未送出的离婚协议'],
    conflicts: ['被逼当众离婚', '家人被上门羞辱', '旧部的番号被取消', '女儿的学费被拿去赌', '祠堂除名'],
    hooks: ['他藏在工具箱里的东西掉出来了', '来接他的车队堵满了整条街', '当年被他救下的人如今身居高位', '岳母口中的大人物朝他鞠躬', '一通电话让整个商会停摆'],
    payoffs: ['一句话让全场起身', '旧部齐声恢复番号', '把曾经受的辱一一还回去', '当众亮出隐藏身份', '让对手在规则内彻底出局'],
    cliffhangers: ['门外传来整齐的踏步声', '手机屏幕上跳出一个代号', '有人当着他的面拨通了某位大人的电话', '女儿怯生生喊出一个称呼', '曾经赶他走的人跪在了雨里'],
    styleHint: '都市',
  },
  '萌宝': {
    heads: ['萌宝', '四岁', '奶团', '小祖宗', '神童'],
    leads: ['独自带娃的单亲妈妈', '被萌宝撮合的冷面总裁', '寻亲路上的外婆', '幼儿园老师', '儿科医生'],
    rivals: ['想把孩子带走的豪门', '抢走客户还造谣的同行', '重男轻女的公婆', '拐带儿童的假护工', '偷偷做亲子鉴定的亲戚'],
    helpers: ['话痨的热心邻居', '退伍的保镖', '懂孩子的老园长', '说实话不绕弯的护士', '收养过孤儿的社工'],
    scenes: ['幼儿园教室', '小区游乐场', '总裁办公室', '医院儿科', '超市玩具区', '警察局接待室', '亲子鉴定中心', '生日派对现场'],
    props: ['一幅蜡笔画', '旧照片', '小书包', '长命锁', '半块饼干'],
    conflicts: ['孩子被强行带走', '亲子关系被质疑', '疫苗记录被动手脚', '家长群里被围攻', '抚养权开庭'],
    hooks: ['四岁的孩子画出了案发现场', '他的眉眼和总裁一模一样', '孩子一句话让全场安静', 'DNA 报告出现了第二个样本', '妈妈的身份远不止表面'],
    payoffs: ['孩子当众说出关键真相', '总裁第一次低头认错', '豪门拿出铁证认亲', '造谣者在证据前道歉', '抚养权当庭反转'],
    cliffhangers: ['孩子突然问「我爸爸呢」', '幼儿园门口停着一排黑车', '鉴定科打来了电话', '妈妈收到一封烫金请柬', '有人喊出了孩子的乳名'],
    styleHint: '都市',
  },
  '重生复仇': {
    heads: ['重生', '再来', '这一世', '回到', '睁眼'],
    leads: ['重生回退婚那日的将门女', '带着记忆重来的破产老板', '睁眼回到高考前的差生', '重生在丈夫葬礼上的寡妇', '回到入宫前的秀女'],
    rivals: ['这一世抢先示好的闺蜜', '挪用公款的合伙人', '换她志愿的表姐', '装深情的负心人', '抢先一步布局的对手'],
    helpers: ['前世为她收尸的少年', '还记得一切的老仆', '市井里的情报贩子', '铁面无私的教官', '同样重生的对手'],
    scenes: ['退婚的宴会厅', '公司会议室', '高三教室', '灵堂', '宫里的储秀宫', '旧书店', '医院天台', '老宅正厅'],
    props: ['前世留下的账本', '一封未寄出的信', '准考证', '葬礼上的白花', '母亲的遗物'],
    conflicts: ['历史重演到关键节点', '仇人比她记得更多', '救人反而引来怀疑', '证据被提前销毁', '盟友临阵倒戈'],
    hooks: ['她记得这一刀会从哪来', '仇人的台词与前世一字不差', '她提前买下了那支必涨的股票', '本该死的人活了下来', '她袖中藏着前世的供词'],
    payoffs: ['让仇人在自己的局里惨败', '当场背出对方的底牌', '把前世受的罪一一还回去', '救下前世没能救的人', '在众人面前揭穿所有伪装'],
    cliffhangers: ['窗外闪过熟悉的影子', '仇人的电话比前世早了一天', '本该出现的第三个人没来', '她发现自己并非唯一重生者', '签字的笔尖悬在纸上'],
    styleHint: '都市',
  },
  '甜宠': {
    heads: ['闪婚', '契约', '隐婚', '邻家', '暗恋'],
    leads: ['契约结婚的普通女孩', '暗恋十年的插画师', '被催婚的急诊科医生', '继承花店的女生', '兼职伴娘的专业户'],
    rivals: ['催婚的强势母亲', '插足的青梅', '门第之见的祖父', '处处比较的同事', '突然回国的前女友'],
    helpers: ['神助攻的闺蜜', '嘴硬心软的男主祖母', '热心过头的居委会阿姨', '店里的老花匠', '懂心理的咨询师'],
    scenes: ['合租公寓', '医院值班室', '花店', '深夜大排档', '老宅院子', '机场', '雨夜便利店', '婚礼后台'],
    props: ['一枚旧戒指', '手写菜单', '旧吉他', '围巾', '两张电影票'],
    conflicts: ['契约被家人撞破', '前任带着秘密回国', '误会彼此另有其人', '家长见面谈崩', '事业与感情二选一'],
    hooks: ['领证当天发现对方是顶头上司', '他记得她十年前的口头禅', '契约条款里藏着一条认真的约定', '全世界只有他信她', '那枚戒指本该属于别人'],
    payoffs: ['当众承认关系', '为她破一次例', '把误会一次性说清', '在她最狼狈时出现', '用行动否定所有门第之见'],
    cliffhangers: ['门铃在深夜响起', '手机里弹出一条合照', '他第一次没有接她电话', '雨里跑来一个抱花的人', '电梯门合上时她看见了他'],
    styleHint: '都市',
  },
};
const DEFAULT_PACK = GENRE_PACKS['女频逆袭'];

/* ---------------- 动作/台词池（按情绪） ---------------- */
const ACTION_BY_MOOD = {
  tense: ['指节发白，攥紧了手里的东西', '呼吸压得很低，眼睛盯着门口', '后退半步，腰抵上了桌沿', '把话咽回去，指尖在袖中掐紧', '猛地抬头，目光撞上来人', '一把将东西拢进袖中', '侧身挡住身后的孩子', '手按在剑柄/椅背上没有松开'],
  // 参照实现必须干净：「像在做一件平常事」这种不可拍的比喻已改成单一动作
  // （这是内容体检的「网文腔」项会抓的写法——样本引擎自己先不能犯规）
  calm: ['慢慢抬起眼，语气没有起伏', '把东西推回桌子中央', '抬手示意对面先坐', '垂眼把袖口的褶皱一寸寸抹平', '轻轻摇头，笑意不达眼底', '把灯芯拨高了一寸', '合上书，指腹停在封面上', '后退一步，让出门口的位置'],
  turn: ['当众把东西摔在桌上', '一字一顿，把话说完', '站起身，椅子腿刮过地面', '抬手止住周围的嘈杂', '从袖中取出一封信', '当着众人的面解开外面那件', '走过去，把门带上', '抬手抚过旧物，忽然笑了'],
};
const LINE_BY_MOOD = {
  tense: ['这东西上了我的船，就下不去了', '你最好现在说清楚', '我数三声，让开', '别过来', '你以为我不知道？', '这账，我们慢慢算', '谁动她一下试试'],
  calm: ['坐，话还没说完', '急什么，戏才刚开始', '我自有分寸', '这件事，不劳你费心', '天还没亮呢', '你确定查清楚了？', '我不急，你慢慢想'],
  turn: ['今日之后，桥归桥路归路', '这颗人头，我记下了', '从今往后，各行其道', '我既然来了，就没打算空手回去', '这一局，我押上全部', '你欠的，今日一并还清', '我才是那个该坐在主位的人'],
};
const DELIVERIES = ['声音很轻，却没商量', '带着笑意，眼神不笑', '一字一顿', '压低嗓音，只够两人听见', '尾音发颤，人却站着没动', '平静得像在报天气', '冷笑一声，转身就走', '顿了很久才开口'];
const LIGHTINGS = ['清晨薄雾', '正午强光', '黄昏逆光', '夜里烛火', '阴天散射', '雪后冷光', '灯下暖光', '雨后青白'];

/* ---------------- 生成上下文 ---------------- */
/** 梗概必须是叙述体：引号对白会踩 no-dialogue 门，统一剥掉 */
const stripQuotes = (s) => String(s ?? '').replace(/[「」『』“”]/g, '');

function makeCtx({ title = '', genre = '女频逆袭', episodes = 3, minutesPerEpisode = 2, idea = '', source = '', variant = '' } = {}) {
  const pack = GENRE_PACKS[genre] ?? DEFAULT_PACK;
  // variant 是每次生成的一次性标记（见 scriptService.variantTag）：
  // 进了种子，同一个创意连点两次也会换一批人名与钩子，而不是逐字节相同。
  // 样本引擎是纯函数，不加这一维就等于「点多少次都一样」。
  const seedText = `${idea || source || ''}|${genre}|${episodes}|${minutesPerEpisode}|${title || ''}|${variant}`;
  const bag = new Bag(mulberry32(hashStr(seedText)));
  // 用户创意里的关键词抽出来织进剧情（"渡口"两个字也要能改变结果）
  const kw = (idea || source || '').replace(/[，。！？、\s]/g, '').slice(0, 4);

  const lead = bag.pick(pack.leads);
  const rival = bag.pick(pack.rivals);
  const helpers = bag.take(pack.helpers, 2);
  const scenes = bag.take(pack.scenes, 3);
  const prop = bag.pick(pack.props);
  const nameLead = bag.pick(SURNAMES) + (bag.rnd() > 0.5 ? bag.pick(GIVEN_F) : bag.pick(GIVEN_M));
  const nameRival = bag.pick(SURNAMES) + (bag.rnd() > 0.5 ? bag.pick(GIVEN_F) : bag.pick(GIVEN_M));
  const nameHelpers = helpers.map(() => bag.pick(SURNAMES) + bag.pick(bag.rnd() > 0.5 ? GIVEN_F : GIVEN_M));
  const dramaName = (kw ? `${kw}` : bag.pick(pack.heads)) + bag.pick(pack.conflicts).slice(0, 4);

  return { bag, pack, kw, dramaName, lead, rival, helpers, scenes, prop, nameLead, nameRival, nameHelpers, genre, episodes, minutesPerEpisode };
}

/* ---------------- 大纲 ---------------- */
function buildOutline(params = {}) {
  const c = makeCtx(params);
  const { bag, pack, kw } = c;
  const leadName = c.nameLead;
  const rivalName = c.nameRival;

  const characters = [
    { id: 'C01', name: leadName, role: c.lead, tier: 'lead', arc: '从被动承受到主动出手', from: ['开场'] },
    { id: 'C02', name: rivalName, role: c.rival, tier: 'lead', arc: '从步步紧逼到自露马脚', from: ['开场'] },
    { id: 'C03', name: c.nameHelpers[0], role: c.helpers[0], tier: 'support', arc: '从旁观到选边', from: ['第一集'] },
    { id: 'C04', name: c.nameHelpers[1], role: c.helpers[1], tier: 'functional', from: ['第二集'] },
  ];

  const sceneDefs = c.scenes.map((s, i) => ({
    id: `S0${i + 1}`, name: kw && i === 0 ? `${kw}${s}` : s,
    primary: i < 2, reusePlan: i === 0 ? '全剧主场景，靠光照与前景变化区分场次' : '关键节点复用，每次带一件不同道具',
  }));

  const beats = [];
  // 节拍序列按「短剧框架」走（复仇逆袭 / 悬疑钩子 / 重生先知…），
  // 这是样本模式下唯一能体现框架差异的地方：同一题材换框架，节拍结构就不同
  const { types: beatTypes, majorAt } = frameworkBeatSeq(params.framework);
  for (let i = 0; i < Math.max(4, c.episodes + 2); i += 1) {
    const slot = i % beatTypes.length;
    const type = beatTypes[slot];
    // i === 0 一定给 major：major-early 门要求大爆点不能只在最后一集才首现
    const weight = i === 0 || majorAt.includes(slot) ? 'major' : 'normal';
    // 回合型节拍（打脸/反击/揭示）的 setup 用「压迫」词库，其余用钩子词库
    const isTurn = /打脸|反击|反打|碾压|定局|爽点|揭示|亮身份/.test(type);
    beats.push({
      id: `B${String(i + 1).padStart(2, '0')}`,
      type,
      weight,
      episode: (i % Math.max(1, c.episodes)) + 1,
      setup: bag.pick(isTurn ? pack.conflicts : pack.hooks),
      payoff: bag.pick(pack.payoffs),
    });
  }

  const eps = [];
  for (let i = 1; i <= c.episodes; i += 1) {
    const conflict = bag.pick(pack.conflicts);
    // 引用覆盖：人物与场景按集轮换，保证每个人、每个场景都在系列里出现过
    // （refs 门会查「失业角色 / 空转场景」，漏一个就不过）
    const charIds = characters.map((_, k) => characters[(k + i - 1) % characters.length].id);
    const sceneIds = sceneDefs.map((_, k) => sceneDefs[(k + i - 1) % sceneDefs.length].id).slice(0, 3);
    const synopsis = `第${i}集：${leadName}${conflict}。${bag.pick(pack.hooks)}。${kw ? `线索指向${kw}。` : ''}这一集她必须做出选择。`;
    const hook = bag.pick(pack.hooks);
    const cliff = i === c.episodes ? bag.pick(pack.cliffhangers) : `${bag.pick(pack.cliffhangers)}（埋给第${i + 1}集）`;
    // risk-flag 门：文本里出现雨戏/肢体接触/人群/手部特写等难点词，
    // 就必须把对应难点写进本集 warnings——扫出来自动补，不靠运气
    const risks = Object.entries(OUTLINE_RISKS)
      .filter(([, re]) => re.test(`${synopsis} ${hook} ${cliff}`))
      .map(([name]) => name);
    eps.push({
      ep: i,
      // 剥引号：梗概/钩子/悬念必须是叙述体，词库里的「」会踩 no-dialogue 门
      synopsis: stripQuotes(synopsis),
      hook: stripQuotes(hook),
      suspense: stripQuotes(cliff),
      sceneIds,
      characterIds: charIds,
      propIds: ['P01'],
      crowdPlan: `${leadName}居画面主位，${rivalName}在其对面，${c.nameHelpers[0]}占高点/远景`,
      warnings: risks,
    });
  }

  return {
    source: stripQuotes(c.dramaName),
    lang: 'zh',
    genre: c.genre,
    params: { episodes: c.episodes, minutesPerEpisode: c.minutesPerEpisode, genre: c.genre, adaptMode: '抽核', preferences: [], thresholds: {} },
    adaptation: {
      core: `把故事压成一件事：${leadName}如何面对「${bag.pick(pack.conflicts)}」，并在${c.scenes[0]}里翻盘。`,
      keep: [{ what: `${c.scenes[0]}的空间关系`, why: '全剧主场景，压缩成本最低', evidence: bag.pick(pack.hooks) }],
      cut: [{ what: bag.pick(['支线家族恩怨', '配角前史', '地理迁徙过程']), why: `${c.minutesPerEpisode}分钟内讲不清，且会稀释主线`, evidence: '' }],
      merge: [{ what: bag.pick(['两个功能性随从并为一个', '两场过渡戏合并', '两位长辈角色合一']), why: '功能性角色不必分人头', evidence: '' }],
      risks: [{ what: bag.pick(['夜景戏对出图不友好', '群戏易产生双胞胎脸', '同场景连续多场易视觉疲劳']), plan: '统一用固定光照处理，并靠前景物件区分' }],
      cutNote: '', mergeNote: '',
    },
    characters,
    scenes: sceneDefs,
    props: [{ id: 'P01', name: c.prop, function: `悬念载体，${leadName}与${rivalName}的争夺焦点`, beatIds: ['B01'] }],
    beats,
    episodes: eps,
  };
}

/* ---------------- 剧本 ---------------- */
function buildScript({ seedEpisodes = [], source = '', characters = ['C01', 'C02'], scenes = ['S01', 'S02'], framework = DEFAULT_FRAMEWORK_ID } = {}) {
  const bag = new Bag(mulberry32(hashStr(`script|${source}|${(seedEpisodes ?? []).length}|${scenes.join(',')}`)));
  const totalEps = (seedEpisodes ?? []).length || 1;
  const episodes = (seedEpisodes ?? []).map((seedEp, ei) => {
    // 每集场次随目标时长伸缩：1 分钟 3 场、2 分钟 4 场、3 分钟以上 5 场
    const perEp = seedEp.targetSeconds ?? 120;
    const sceneCount = perEp <= 60 ? 3 : perEp <= 130 ? 4 : 5;
    // 每场节拍数按引擎折算公式反推：动作 2.5s + 台词 字数/4.5s，
    // 交替排布时平均约 2.4s/拍。取 0.95 系数落在 ±15% 允许带中部，
    // 不贴边——贴边会被台词长短的波动顶出界
    const perScene = perEp / sceneCount;
    const beatsPerScene = Math.max(7, Math.min(24, Math.ceil(perScene / 2.4 * 0.95)));
    const scs = [];
    for (let si = 0; si < sceneCount; si += 1) {
      const sceneId = scenes[(ei + si) % scenes.length] ?? `S0${si + 1}`;
      const mood = si === sceneCount - 1 ? 'turn' : si === 0 ? 'tense' : bag.pick(['calm', 'tense', 'turn']);
      const cast = characters.slice(0, bag.int(2, Math.min(3, characters.length)));
      scs.push({
        sceneId,
        lighting: bag.pick(LIGHTINGS),
        characters: cast,
        props: si === 0 ? ['P01'] : [],
        flow: buildFlow(bag, mood, cast, beatsPerScene),
      });
    }
    // 节奏定位与集间承接：真模型走 prompt 拿这两个字段，样本引擎按框架的序列直接算，
    // 保证两条路径在「内容体检」下的表现一致（否则样本模式必然报「没声明节奏定位」）
    const springPlan = frameworkSpringPlan(framework, totalEps);
    return {
      ep: seedEp.ep,
      spring: springPlan[seedEp.ep - 1],
      carryFrom: seedEp.ep === 1 ? 'unit' : 'scene',
      targetSeconds: seedEp.targetSeconds,
      hook: seedEp.hook,
      cliff: seedEp.cliff,
      beatsClaimed: seedEp.beatsClaimed ?? [],
      scenes: scs,
    };
  });
  return { source, episodes };
}

/** 一场的节拍流：动作与台词交替，末镜必收在动作/台词上 */
function buildFlow(bag, mood, cast, n = 9) {
  const flow = [];
  const actions = ACTION_BY_MOOD[mood];
  const lines = LINE_BY_MOOD[mood];
  for (let i = 0; i < n; i += 1) {
    if (i % 2 === 0 || i === n - 1) {
      flow.push({ action: bag.pick(actions) });
    } else {
      const speaker = cast[(i - 1) % cast.length] ?? 'C01';
      flow.push({ speaker, line: bag.pick(lines), delivery: bag.pick(DELIVERIES) });
    }
  }
  return flow;
}

/* ---------------- 优化 / 抓取（沿用既有结构，内容走随机） ---------------- */
const pick = (arr, i) => arr[Math.abs(Math.trunc(i)) % arr.length];

/** 分镜拆分样本 v2：15 秒段 + 5 个子镜头；台词一句不丢、每场有段、词表合法 */
function buildShots({ ep = 1, wantSeg = 1, scenes = 1, chars = 2, lines = [] } = {}) {
  const sceneCount = Math.max(1, Number(scenes) || 1);
  const list = Array.isArray(lines) ? lines : [];
  const segCount = Math.min(12, Math.max(sceneCount, Math.ceil(list.length / 5), Number(wantSeg) || 1, 1));
  const castCount = Math.max(1, Number(chars) || 2);
  const sizes = ['medium', 'medium-close', 'close-up', 'wide', 'medium'];
  const moves = ['static', 'push-in', 'pull-back', 'tracking', 'handheld'];
  const segments = [];
  let li = 0;
  for (let si = 0; si < segCount; si += 1) {
    const shots = [];
    for (let k = 0; k < 5; k += 1) {
      const picked = list[li++] ?? null;
      const line = typeof picked === 'string' ? picked : picked?.line ?? '';
      const cid = (typeof picked === 'object' ? picked?.speaker : '') || `C${String((k % castCount) + 1).padStart(2, '0')}`;
      shots.push({
        sec: 3,
        size: sizes[k % sizes.length],
        move: moves[k % moves.length],
        visual: line ? `角色开口说出这一句台词` : `角色完成第 ${k + 1} 个可见动作`,
        speaker: line ? cid : '',
        cast: line || k % 2 === 0 ? [cid] : [],
        line,
        tone: line ? (k % 2 === 0 ? '冷笑' : '严肃') : '',
        motion: ['hand moves slightly', 'shoulder shifts'],
        lighting: k % 2 === 0 ? '顶光偏冷' : '窗边侧光',
      });
    }
    segments.push({
      sceneIndex: (si % sceneCount) + 1,
      sec: 15,
      beat: si === 0 ? '钩子' : si === segCount - 1 ? '高潮' : '铺垫',
      env: '室内场景，前景有遮挡',
      lighting: '室内顶光偏冷，背景虚化',
      blocking: 'C01 在画面左侧（面朝右）；C02 在画面右侧（面朝左）；两人相距约一臂。',
      shots,
    });
  }
  return { ep, segments };
}

/** 剧本评估的「模型评审」（样本）：结构与真模型完全一致，前端不为样本单开分支 */
function buildEval({ episodes = 1, failed = 0 } = {}) {
  const n = Math.max(1, Number(episodes) || 1);
  const bad = Math.max(0, Number(failed) || 0);
  const base = Math.max(52, 84 - bad * 3);
  const mid = Math.max(2, Math.round(n / 3));
  return {
    verdict: base >= 85 ? '优秀' : base >= 72 ? '良好' : base >= 60 ? '及格' : '不合格',
    score: base,
    summary: `样本评审：${n} 集骨架清楚，前 3 集钩子密度够；中段（第 ${mid} 集起）推进偏平，爽点兑现慢半集。`,
    dimensions: {
      hook: Math.min(96, base + 4),
      character: base - 2,
      dialogue: Math.max(40, base - 6),
      pacing: Math.max(40, base - 9),
      commercial: base,
    },
    strengths: [
      '第 1 集开场三拍就进冲突，没有铺垫寒暄',
      '反派在第 2 集就有明确动作，不只是放狠话',
      '集尾卡点多落在情绪最高点，适合直接剪推广切片',
    ],
    risks: [
      `第 ${mid} 集起连续两集信息量偏少，观众容易在这里划走`,
      '部分台词在替观众解释已经演过的内容，网文腔明显',
    ],
    fixes: [
      {
        where: `第 ${mid} 集`,
        what: '把这一集中段改成一次当众对峙，让主角拿到一个看得见的战利品',
        why: '中段没有「赢一回合」，追剧动力会掉',
      },
      { where: '全集', what: '删掉人物互相复述已知信息的台词，改成动作反应', why: '解释型台词是完播率杀手，也不像真人说话' },
    ],
  };
}

function buildOptimize({ problems = [], source = '' } = {}) {
  const bag = new Bag(mulberry32(hashStr(`opt|${source}|${problems.length}`)));
  const filler = bag.take(['又补了一个动作，把停顿填满', '加了一句低声的自语', '让人物把东西换到另一只手', '补一个回身看的动作', '加一次呼吸的停顿'], 5);
  const episodes = [];
  for (let i = 1; i <= 2; i += 1) {
    episodes.push({
      ep: i,
      targetSeconds: 120,
      hook: '优化后的本集钩子',
      cliff: '优化后的集尾悬念',
      beatsClaimed: ['悬念钩'],
      scenes: [{
        sceneId: `S0${i}`,
        lighting: pick(LIGHTINGS, i),
        characters: ['C01', 'C02'],
        props: ['P01'],
        flow: [
          { action: filler[i - 1] ?? '补一个动作' },
          { speaker: 'C01', line: '优化后的短句台词。', delivery: '平稳' },
          { speaker: 'C02', line: '回应一句。', delivery: '低沉' },
          { action: '再补一个收尾动作' },
        ],
      }],
    });
  }
  return { source, episodes };
}

/* ---------------- 剧本生成三段式（都市涅槃标准稿） ----------------
 * 与真模型同一条 prompt 契约：story 吐梗概人设 JSON、epoutline 吐分集大纲 JSON、
 * epscript 吐都市涅槃格式正文。样本引擎按同一形状造，保证 mock 模式下
 * 解析、门禁、组装整条链路是活的（换真 API 只换内容，不换结构）。 */

function buildStoryGen(params = {}) {
  const concept = String(params.concept ?? '');
  const bag = new Bag(mulberry32(hashStr(`storygen|${concept}|${params.genre ?? ''}|${params.episodes ?? 40}`)));
  const name = () => bag.pick(SURNAMES) + bag.pick(bag.rnd() > 0.5 ? GIVEN_F : GIVEN_M);
  const [lead, rival, male, second, father, assistant] = [name(), name(), name(), name(), name(), name()];
  const kw = concept.replace(/[，。！？、\s]/g, '').slice(0, 4);
  const title = `${kw || '都市'}${bag.pick(['涅槃', '归位', '破局', '锋芒', '逆袭'])}`;
  return {
    title,
    logline: `${lead}被至亲至信联手夺走一切，重生归来步步为营，把属于她的全部拿回来。`,
    synopsis: `${lead}遭闺蜜与未婚夫联手算计，公司被夺、名誉尽毁，意外回到三年前的酒会当晚。这一世她收起柔软，冷静布局反击，结识了权势滔天的${male}。反派一次次使用商业陷害与造谣抹黑，屡屡自食恶果。最终罪行全部曝光，${lead}守住事业，也与${male}双向奔赴。`,
    genre: params.genre ?? '都市重生复仇',
    characters: [
      { name: lead, role: '女主', desc: '理智清醒，爱恨分明。前世错信他人，身败名裂；这一世冷静布局，守护自己的事业。' },
      { name: rival, role: '反派/前未婚夫', desc: '野心勃勃，自私薄情。贪图她的创业成果，表面温文尔雅，内心阴狠，为达目的不择手段。' },
      { name: male, role: '男主', desc: '顶级财阀幕后掌权人，强势护短，外冷内热。看透她伪装下的脆弱，选择无条件站在她身后。' },
      { name: second, role: '反派女配', desc: '她的昔日闺蜜，嫉妒心极强。善于伪装柔弱善良，暗地里挑唆背叛、造谣生事。' },
      { name: father, role: '父亲', desc: '传统商人，前期被反派的伪装迷惑，后来与女儿站在一起。' },
      { name: assistant, role: '助理', desc: '她的贴身助理，忠诚干练，是最得力的帮手。' },
    ],
  };
}

function buildEpOutline(params = {}) {
  const from = Math.max(1, Number(params.from) || 1);
  const to = Math.max(from, Number(params.to) || from);
  const cast = Array.isArray(params.cast) && params.cast.length ? params.cast : ['女主', '男主', '反派'];
  const bag = new Bag(mulberry32(hashStr(`epoutline|${params.title ?? ''}|${from}|${to}`)));
  const scenePool = bag.take(['铂悦酒店·顶层酒会大厅', '夜色清吧·吧台角落', '苏家别墅·卧室', '城市国际大厦·贵宾通道', '废弃仓库'], 3);
  // 爽点类型必须落在 THRILLS 矩阵内（见 assets/genreLibrary.js），否则样本和真模型的
  // 口径不一致，按题材配额统计时会对不上
  const beatTypes = ['打脸', '逆袭', '反转', '悬疑', '燃'];
  const episodes = [];
  for (let ep = from; ep <= to; ep += 1) {
    const sc = [scenePool[ep % scenePool.length], scenePool[(ep + 1) % scenePool.length]];
    const castN = Math.min(cast.length, 2 + (ep % 3));
    // 轮换取人：保证一批 10 集里每个小传角色都至少出场一次，
    // 否则大纲 refs 门报「失业角色」（真人模型这条靠提示词约束，样本引擎靠轮换）
    const off = ep % cast.length;
    const rotated = [...cast.slice(off), ...cast.slice(0, off)];
    const speakers = rotated.slice(0, castN);
    episodes.push({
      ep,
      synopsis: `起：${speakers[0]}回到命运转折的当晚。承：${speakers[1 % speakers.length]}发难，当众撕破脸。转：${speakers[0]}冷静反将一军。合：局势翻转，${speakers[1 % speakers.length]}脸色铁青。`,
      openHook: `${speakers[0]}抬眼，眼底只剩冰冷。`,
      endHook: `${speakers[1 % speakers.length]}伸手，就要攥住她的手腕。`,
      scenes: [
        { location: sc[0], event: `${speakers[0]}与${speakers[1 % speakers.length]}当众对峙` },
        { location: sc[1], event: `${speakers[0]}私下联络${speakers[speakers.length - 1]}，布局反击` },
      ],
      cast: speakers,
      crowdPlan: castN >= 3 ? '三人对峙：主角居中，反派左侧施压，配角右侧递证据，其余宾客背景虚化。' : '',
      beats: [{
        type: beatTypes[ep % beatTypes.length],
        // 每批第一集和卡尾集给 major：major-early 门要求大爆点不能只在最后一集才首现
        weight: ep === from || ep % 10 === 0 ? 'major' : 'minor',
        setup: `${speakers[1 % speakers.length]}的算计浮出水面`,
        payoff: `${speakers[0]}当众反将一军`,
      }],
    });
  }
  return { episodes };
}

/** 都市涅槃格式的单集正文：台词全部 ≤22 字，每场 ≥2 个 △，结尾钩子字幕+黑屏齐全 */
function buildEpScript(params = {}) {
  const ep = Math.max(1, Number(params.ep) || 1);
  const cast = Array.isArray(params.cast) && params.cast.length ? params.cast : ['女主', '反派'];
  const scenes = Array.isArray(params.scenes) && params.scenes.length ? params.scenes : ['铂悦酒店·顶层酒会大厅', '苏家别墅·卧室'];
  const bag = new Bag(mulberry32(hashStr(`epscript|${params.title ?? ''}|${ep}`)));
  const [a, b] = [cast[0], cast[1 % cast.length]];
  const [c] = cast.length > 2 ? [cast[2]] : [a];
  const HYPHEN = '\u2011'; // 都市涅槃格式的场号连字符是 U+2011，不是普通减号
  const L = [
    '今天，我正式解除这场婚约。',
    '项目半分，你也别想拿走。',
    '你的演技，实在令人作呕。',
    '这一切，我全部牢牢记住。',
    '识相一点，主动交出来。',
    '凭什么都给你？你想得美。',
    '大戏，正式开演。',
    '不要逼我，否则两败俱伤。',
  ];
  const A = [
    '当众取下订婚戒指，扔在大理石台面。',
    '死死攥紧手心，指甲嵌入皮肉。',
    '快步上前，挡在她身前，神色冷峻。',
    '眼眶通红，拿出手帕擦拭眼角。',
    '后退半步，掌心凝聚一层微光。',
    '转身，带着众人离开大厅。',
  ];
  const s1 = scenes[0];
  const s2 = scenes[1] ?? scenes[0];
  // 台词/动作按序循环取，一批里不重复——样本内容也要像个剧本，不能同一句出现两次
  const seq = (arr) => { const pool = [...arr]; let i = 0; return () => pool[i++ % pool.length]; };
  const nextL = seq(L);
  const nextA = seq(A);
  return `## 第${ep}集
场${ep}${HYPHEN}1 夜 内 ${s1}
人物：${cast.slice(0, 3).join('、')}、宾客若干

△字幕：${s1}
△${nextA()}
△${b}一身高定西装，扶着${c}站在露台边。

${b}对着身边宾客：${nextL()}

△${a}站在人群不远处，神色淡淡，指尖微微发抖。

${a}抬眼：${nextL()}

△${b}抬手，当众取下订婚戒指，扔在大理石台面。

${b}高声：${nextL()}

△全场哗然。${a}死死攥紧手心，刺痛传来。

【闪回】
场${ep}${HYPHEN}2 夜 外 旧写字楼楼顶
人物：${a}、${b}

△冷风呼啸，雨夜。${a}浑身湿透，衣衫破烂。

${b}冷笑：${nextL()}
【闪出】

场${ep}${HYPHEN}3 夜 内 ${s2}
人物：${a}、${c}

△${a}回到卧室，反锁房门，取出一枚加密通讯吊坠。

${a}OS：我回来了……回到他们当众毁约的这一晚。

△${a}握住吊坠，房间半空凝聚出全息虚影。

${c}声音低沉：${nextL()}

△${a}闭上双眼，肩膀微微一颤。

${a}轻声：${nextL()}

【钩子字幕】${b}当众宣布解除婚约，${a}眼底只剩冰冷！
【黑屏】第${ep}集完`;
}


/* ---------------- 小说创作（设定集 / 章纲 / 正文） ----------------
 * 样本引擎只保证「链路能跑通、门禁能被真的过一遍」，不追求文学质量。
 * 但正文必须满足门禁（字数、对话、钩子、无总结结尾、AI 痕迹分），
 * 否则测试会在样本模式下红一片，看起来像功能坏了。 */
function buildNovelBible(params = {}) {
  const title = String(params.title || '未命名长篇');
  const h = hashStr(`novelbible|${title}`);
  const names = ['沈砚', '江照', '陈九', '阿棠', '老陆', '白珩'];
  const roles = ['主角', '女主', '反派', '配角', '配角', '配角'];
  const wants = ['查清父亲当年的船难', '把码头从舅舅手里拿回来', '让所有人闭嘴', '离开这条街', '保住最后一间铺子', '等到一个说法'];
  const flaws = ['不信任何人，连证据都要自己再验一遍', '怕水，却必须住在江边', '一旦占上风就收不住手', '欠了不该欠的人情', '记性差，常常忘了自己说过的话', '太要面子'];
  const voices = ['句子短，少用形容词，习惯先报数字', '爱用反问，从不下结论', '说话像在下命令', '一句话里能塞三个语气词', '喜欢用旧词，张口就是三十年前', '客客气气，句句带刺'];
  const characters = names.slice(0, 4 + (h % 3)).map((name, i) => ({
    name, role: roles[i % roles.length], want: wants[i % wants.length],
    flaw: flaws[i % flaws.length], voice: voices[i % voices.length],
    arc: i === 0 ? '从只信证据，到愿意为一个不确定的人下注' : '在关键一章做出与本性相反的选择',
  }));
  const world = [
    { rule: '潮汐退到最低时，旧码头的石阶会露出一段不该存在的门', cost: '每次开门要拿一个人的名字去换', bound: '名字一旦给出，说的人在世上就再没被提起过' },
    { rule: '江上的雾能盖住声音，但盖不住血味', cost: '雾散之后，身上会留下洗不掉的腥气', bound: '只能在无风的夜里起雾' },
    { rule: '船票是认人的，转手就作废', cost: '换票的人要留下一样随身的东西', bound: '一人一票，票根不能离身' },
    { rule: '码头的老秤只称真话', cost: '说谎的人称出来的重量会轻三两', bound: '只在午夜到天亮之间准' },
  ];
  return {
    promise: {
      sellingPoint: '所有人都说那场船难是意外，只有他记得那天江面上一盏没熄的灯。',
      theme: '一个人要为真相付出多少，才算付得起。',
      ending: '他拿回的不是清白，是一个愿意作证的人；代价是他自己的名字被从江上抹掉。',
    },
    characters,
    world,
  };
}

function buildNovelOutline(params = {}) {
  const total = Math.max(6, Number(params.chapters) || 12);
  const h = hashStr(`noveloutline|${params.title ?? ''}|${total}`);
  const goals = ['拿到第一份旧船票', '混进码头夜班', '逼出第一个证人', '第一次开门', '被自己人出卖', '换回一个名字'];
  const conflicts = ['守夜人认得他的脸', '舅舅提前封了闸口', '证人要的不是钱', '门后的东西不认生人', '同伴先开了口', '对方拿走了他唯一的票根'];
  const turns = ['以为在查别人，其实被查的是自己', '证人早就死了，说话的是他儿子', '开门换来的不是答案，是新的债', '救他的人正是害他的人', '他以为赢了，其实签了字', '真相只值一张船票'];
  const hooks = ['门外有人敲了三下，停了两秒，又敲了一下。', '他低头看票根，日期是明天。', '“你父亲那天，也在船上。”', '雾里有人喊了他的名字。', '秤杆停住了，比应得的轻了三两。', '灯亮了，照见一张不该出现的脸。'];
  const chapters = Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    title: ['灯', '票', '秤', '雾', '门', '名字'][i % 6] + (i < 6 ? '（上）' : '（下）'),
    goal: goals[(i + h) % goals.length],
    conflict: conflicts[(i + h) % conflicts.length],
    turn: turns[(i + h) % turns.length],
    hook: hooks[(i + h) % hooks.length],
    characters: ['沈砚'],
  }));
  const foreshadow = [
    { id: 'F1', content: '那盏没熄的灯是谁点的', plantAt: 1, payoffAt: Math.max(2, Math.round(total * 0.7)), tier: 1 },
    { id: 'F2', content: '票根背面的一行小字', plantAt: 2, payoffAt: Math.max(3, Math.round(total * 0.9)), tier: 1 },
    { id: 'F3', content: '老陆每次说到三十年前都会咳嗽', plantAt: 3, payoffAt: total, tier: 2 },
  ];
  const volSize = Math.max(6, Math.ceil(total / Math.max(1, Math.ceil(total / 20))));
  const volumes = [];
  for (let from = 1; from <= total; from += volSize) {
    volumes.push({ name: `卷${volumes.length + 1}`, from, to: Math.min(total, from + volSize - 1), climax: '他把票根拍在秤上' });
  }
  return { volumes, chapters, foreshadow };
}

function buildNovelChapter(params = {}) {
  const idx = Math.max(1, Number(params.index) || 1);
  const words = Math.max(800, Number(params.words) || 3000);
  const title = String(params.title || '');
  const h = hashStr(`novelchapter|${title}|${idx}`);

  // 段落必须长短交错：句长 cv 和段长 cv 是「去 AI 味」13 维里权重最高的两项之一，
  // 一段一段都是同样长度的四行，扫描器一眼就看出来是机器写的（分数会卡在 55 以上）。
  const pool = [
    '台阶上有一层薄薄的水，鞋底碾过去，发出很轻的一声。',
    '守夜人没抬头。',
    '他把手插进兜里，摸到那张磨毛的纸边，指腹在折痕上停了一下，又往前推了半寸。',
    '汽笛拉长半拍。',
    '空气里有股铁腥味，混着潮气，往领口里钻；他闻了闻，像血，又不太像。',
    '灯只亮了一半。',
    '他数台阶，十一级，比记忆里多一级。多出来的那一级是新的，水泥还没干透。',
    '江面黑得没有反光。',
    '守夜人的电筒晃了一下，停住，又晃了一下。',
    '他把票根摊开，又攥回去，纸角扎进掌心。',
    '雾贴着水面走，慢，像有人拖着一床湿被子。',
    '他没再往前走。',
  ];
  const lines = [
    ['沈砚', '今晚开闸吗。'],
    ['守夜人', '不开。你走错地方了。'],
    ['沈砚', '我父亲的票，是你们卖给他的。'],
    ['守夜人', '票认人，不认儿子。'],
    ['沈砚', '那就认我。'],
    ['守夜人', '你连他的名字都不敢说。'],
    ['沈砚', '他叫沈复。三十年前，跑夜船。'],
    ['守夜人', '名字我记住了。你可以走了。'],
  ];
  const hook = [
    '门外有人敲了三下，停了两秒，又敲了一下。',
    '他低头看票根，日期是明天。',
    '雾里有人喊了他的名字。',
    '灯全灭了。只剩他一盏手电，照着台阶上新踩出来的脚印。',
  ][idx % 4];

  const seq = [4, 0, 2, 1, 6, 3, 8, 5, 9, 10, 7, 11];
  let out = pool[(h + 2) % pool.length] + '\n\n';
  let n = out.length;
  let i = 0;
  while (n < words - 90) {
    const para = pool[(h + seq[i % seq.length]) % pool.length];
    out += para + '\n\n';
    n += para.length;
    if (i % 3 === 1) {
      const [who, say] = lines[(h + i) % lines.length];
      const dlg = `${who}：「${say}」`;
      out += dlg + '\n\n';
      n += dlg.length;
    }
    i += 1;
  }
  out += hook;
  return out;
}

/* ---------------- 入口 ---------------- */
export function mockComplete({ system = '', user = '' } = {}) {
  const task = /__TASK__\s*:\s*([a-zA-Z_-]+)/.exec(user)?.[1] || '';
  const paramsRaw = /__PARAMS__\s*:\s*(\{[\s\S]*?\})\s*(?:__|$)/.exec(user)?.[1];
  let params = {};
  if (paramsRaw) {
    try { params = JSON.parse(paramsRaw); } catch { params = {}; }
  }
  switch (task) {
    case 'outline': return JSON.stringify(buildOutline(params), null, 2);
    case 'script': return JSON.stringify(buildScript(params), null, 2);
    case 'optimize': return JSON.stringify(buildOptimize(params), null, 2);
    // 剧本生成三段式（都市涅槃格式）：story/epoutline 吐 JSON，epscript 吐 Markdown 正文
    case 'story': return JSON.stringify(buildStoryGen(params), null, 2);
    case 'epoutline': return JSON.stringify(buildEpOutline(params), null, 2);
    case 'epscript': return buildEpScript(params);
    // 剧本评估的模型评审（JSON）与逐集改写（Markdown 正文）
    case 'shots': return JSON.stringify(buildShots(params), null, 2);
    case 'eval': return JSON.stringify(buildEval(params), null, 2);
    case 'optrewrite': return buildEpScript(params);
    // 小说创作：设定集/章纲吐 JSON，正文吐 Markdown
    case 'novelbible': return JSON.stringify(buildNovelBible(params), null, 2);
    case 'noveloutline': return JSON.stringify(buildNovelOutline(params), null, 2);
    case 'novelchapter': return buildNovelChapter(params);
    default: return JSON.stringify({ ok: true, note: 'mock 默认应答', task }, null, 2);
  }
}
