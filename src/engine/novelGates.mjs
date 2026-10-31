/**
 * 小说引擎 · 确定性门禁
 *
 * 为什么不把这些判断交给模型：
 *   「这一章字数够不够、有没有钩子、伏笔有没有回收」全是可数的东西。
 *   模型自评会说「已符合要求」，但它不会去数。门禁只做能算的事，
 *   「好不好看」那一层留给模型评审（本项目剧本链路同一条分界）。
 *
 * 与剧本门的关系：形状不同，口径一致——都是纯函数、都返回
 * {id,label,ok,detail}，可以直接和 24 道剧本门并列展示。
 *
 * 【自由写作】
 *   章节写作不设限：不限定章数、篇幅、结构、风格。所以这里的「门」默认是**建议**
 *   （severity: 'soft'），只报告不拦截；硬拦的只有一条——正文为空。
 *   需要纪律的人可以把自由写作关掉，那时字数/钩子/对话/承接才变成硬门。
 */

const SUMMARY_SIGNALS = ['终于明白', '终于懂了', '从这一刻起', '从此', '他知道', '她明白', '原来这一切'];
// 钩子信号词：只覆盖「明显是悬念」的表达
const HOOK_SIGNALS = ['？', '?', '……', '——', '却', '忽然', '突然', '没想到', '就在这时', '原来', '还没', '直到', '门外', '电话', '敲门', '脚步', '有人'];
/** 末段多短算「落在动作/一句话上」——长段收尾基本都是总结，不像钩子 */
const HOOK_TAIL_CHARS = 60;

const cjk = (s) => String(s ?? '').replace(/[^\u4e00-\u9fff]/g, '');

/** 去掉空白后的净字数（中文按字算，和项目其它地方口径一致） */
export function wordCount(text) {
  return String(text ?? '').replace(/\s+/g, '').length;
}

/**
 * 设定集门禁：立项 + 人物 + 世界观 + 大纲 + 伏笔 + 结局。
 * 这一层在写正文之前跑，避免「先写十万字才发现大纲不成立」。
 */
export function bookGates(book, opts = {}) {
  const freedom = opts.freedom !== false; // 默认自由：章节数由作者决定
  const gates = [];
  /** severity: hard 会挡住下一步；soft 只是建议 */
  const add = (id, label, ok, detail, severity = 'soft') => gates.push({ id, label, ok: Boolean(ok), detail, severity });

  /* 1. 立项：书名与一句话故事 */
  const title = String(book?.title ?? '').trim();
  const logline = String(book?.logline ?? '').trim();
  add('title', '书名', title.length >= 2 && title.length <= 14, title ? `《${title}》${title.length} 字` : '还没起名');
  // 冲突信号：转折词与「想要/阻力」都算。
  // 早先只列了几个动词，把「所有人都说是意外，只有他记得那盏灯」这种
  // 标准冲突句判成「没看出冲突」——门禁不能逼着人往句子里塞关键词。
  const hasConflict = /(却|但|反而|只有|所有人|必须|要|想|为了|除非|不肯|不让|失去|抢|夺|救|瞒|藏|复仇|回到|真相|秘密|代价)/.test(logline);
  add('logline', '一句话故事',
    logline.length >= 12 && logline.length <= 90 && hasConflict,
    logline ? `${logline.length} 字${hasConflict ? '，含冲突' : '，没看出冲突（读者不知道主角要干什么）'}` : '还没写');

  /* 2. 人物：至少 3 人，每人有「要什么」和「怕什么/缺什么」 */
  const cast = Array.isArray(book?.bible?.characters) ? book.bible.characters : [];
  const solid = cast.filter((c) => c?.name && (c?.want ?? '').trim() && (c?.flaw ?? '').trim());
  add('cast', '人物档案',
    cast.length >= 3 && solid.length >= 2,
    cast.length ? `${cast.length} 人，${solid.length} 人写清了欲望与缺陷` : '还没生成人物');

  /* 3. 世界观：至少 3 条规则，且每条有代价或边界 */
  const world = Array.isArray(book?.bible?.world) ? book.bible.world : [];
  const bounded = world.filter((w) => (w?.rule ?? '').trim() && ((w?.cost ?? '').trim() || (w?.bound ?? '').trim()));
  add('world', '世界观规则',
    world.length >= 3 && bounded.length >= Math.ceil(world.length * 0.6),
    world.length ? `${world.length} 条规则，${bounded.length} 条带代价/边界` : '还没生成世界观');

  /* 4. 规模：章数要能装下目标字数（±25%） */
  const chapters = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
  const per = Number(book?.wordsPerChapter) || 0;
  const target = Number(book?.targetWords) || 0;
  const fit = per > 0 ? target / per : 0;
  const scaleOk = chapters.length > 0 && fit > 0 && Math.abs(chapters.length - fit) / fit <= 0.25;
  // 自由写作下不限定章数：只把「规划字数」和「已排章数」摆出来给人参考
  add('scale', freedom ? '篇幅参考' : '篇幅匹配',
    freedom ? true : scaleOk,
    chapters.length
      ? (freedom
        ? `已排 ${chapters.length} 章，按每章 ${per} 字约 ${chapters.length * per} 字；目标 ${target} 字（章数不设限，随时可以加）`
        : `${chapters.length} 章 × ${per} 字 = ${chapters.length * per} 字，目标 ${target} 字${scaleOk ? '' : `（够不到，应约 ${Math.round(fit)} 章）`}`)
      : '还没生成章纲');

  /* 5. 章纲四要素：目标 / 冲突 / 钩子 —— 缺一个这一章就是水 */
  const hollow = chapters.filter((c) => !(c?.goal ?? '').trim() || !(c?.conflict ?? '').trim() || !(c?.hook ?? '').trim());
  add('beats', '章纲要素',
    chapters.length > 0 && hollow.length === 0,
    chapters.length ? (hollow.length ? `第 ${hollow.slice(0, 3).map((c) => c.index).join('、')} 章缺目标/冲突/钩子` : '每章都有目标、冲突、钩子') : '还没生成章纲');

  /* 6. 伏笔：至少 2 条，且都有回收章（只能埋不收 = 挖坑不填） */
  const fore = Array.isArray(book?.outline?.foreshadow) ? book.outline.foreshadow : [];
  const orphan = fore.filter((f) => {
    const plant = Number(f?.plantAt);
    const pay = Number(f?.payoffAt);
    return !(pay > plant) || pay > chapters.length;
  });
  add('foreshadow', '伏笔台账',
    fore.length >= 2 && orphan.length === 0,
    fore.length ? `${fore.length} 条，${orphan.length} 条没回收或章号越界` : '还没有伏笔（长篇至少埋两条）');

  /* 7. 结局方向：先想清楚结尾再写开头 */
  const ending = String(book?.bible?.promise?.ending ?? '').trim();
  add('ending', '结局方向', ending.length >= 4, ending ? ending.slice(0, 40) : '还没定结局（长篇会写飞）');

  return gates;
}

/**
 * 单章门禁：字数是骨架，钩子是留存，对话是密度，AI 痕迹是味道。
 * prev 传上一章，用来查「两章开头不能一个模子」。
 */
export function chapterGates({ book, chapter, prev = null, maxScan = 55, freedom = true, wordPolicy = 'strict' } = {}) {
  const gates = [];
  /**
   * 自由写作（默认）：全部标记为 soft —— 只报告，不拦。
   * 关掉自由写作：字数/钩子/对话/承接/结尾变硬门（AI 痕迹仍是建议，因为它是风格问题）。
   */
  const add = (id, label, ok, detail, severity = freedom ? 'soft' : 'hard') =>
    gates.push({ id, label, ok: Boolean(ok), detail, severity });

  const text = String(chapter?.text ?? '');
  const words = wordCount(text);

  /* 唯一的硬门：正文得存在。自由写作不是「什么都不写也算过」。 */
  add('has-text', '正文存在', words >= 200, words ? `${words} 字` : '没有正文', 'hard');

  const per = Number(book?.wordsPerChapter) || 3000;

  /* 1. 篇幅：默认「严格」——不足 95% 或超出 115% 都算没过。
     strict 是硬门（会触发续写补齐）；loose 只报数不判。 */
  const target = Number(chapter?.targetWords) || per;
  const low = Math.round(target * 0.95);
  const high = Math.round(target * 1.15);
  const strict = wordPolicy !== 'loose';
  add('words',
    strict ? '本章字数' : '篇幅参考',
    strict ? (words >= low && words <= high) : true,
    strict
      ? `${words} 字（目标 ${target}，允许 ${low}–${high}${words < low ? '；偏少，应继续写' : words > high ? '；偏多，建议删减' : ''}）`
      : `${words} 字（篇幅由内容决定，参考 ${target} 字，不设上下限）`,
    strict ? 'hard' : (freedom ? 'soft' : 'hard'));

  /* 2. 钩子：末段要留东西。
   *    两种都算合格：
   *      a) 末段出现悬念信号词（问句、转折、门外有人…）；
   *      b) 末段很短（≤60 字）并收在句号/叹号/引号上——长篇的章末钩子
   *         一定落在「一个动作或一句话」上，长段收尾通常是在总结全章。
   *    早先只认信号词，把「他低头看票根，日期是明天。」这种标准钩子判成不合格，
   *    门禁就开始教人写套话——那正是这个项目最不想发生的事。 */
  const paras = text.trim().split(/\n\s*\n/).filter((p) => cjk(p));
  const last = paras[paras.length - 1] ?? '';
  const hookHit = HOOK_SIGNALS.filter((s) => last.includes(s));
  const shortTail = cjk(last).length > 0 && cjk(last).length <= HOOK_TAIL_CHARS && /[。！？」]$/.test(last.trim());
  add('hook', '章末钩子', hookHit.length > 0 || shortTail,
    hookHit.length
      ? `末段有 ${hookHit.slice(0, 3).join('、')}`
      : shortTail
        ? `末段 ${cjk(last).length} 字短句收尾「${last.trim().slice(0, 24)}」`
        : `末段 ${cjk(last).length} 字且无悬念信号，读者没有理由点下一章`);

  /* 3. 对话占比：通篇叙述的长篇几乎都读不下去 */
  // 引号与「」都要认：提示词要求统一用「」，但模型经常混着来，
  // 只认双引号会把整章对话算成 0，对话密度门就变成误判
  const dlg = [...text.matchAll(/[“"]([^”"]{1,80})[”"]|「([^」]{1,80})」/g)]
    .reduce((n, m) => n + cjk(m[1] ?? m[2] ?? '').length, 0);
  const ratio = words ? dlg / words : 0;
  add('dialog', '对话密度', ratio >= 0.05, `${(ratio * 100).toFixed(1)}%（下限 5%）`);

  /* 4. 承接：相邻两章不能同一个开头，否则读者会以为翻错页 */
  const head = cjk(text).slice(0, 12);
  const prevHead = prev ? cjk(prev.text).slice(0, 12) : '';
  add('repeat', '与上一章承接',
    !prevHead || head.slice(0, 8) !== prevHead.slice(0, 8),
    prevHead ? `本章开头「${head.slice(0, 8)}」/ 上章「${prevHead.slice(0, 8)}」` : '第一章，跳过');

  /* 5. AI 痕迹：复用「去 AI 味」的 13 维扫描结果，不另算一套 */
  if (chapter?.scan && typeof chapter.scan.score === 'number') {
    add('deai', 'AI 痕迹', chapter.scan.score <= maxScan, `AI 痕迹分 ${chapter.scan.score} ${chapter.scan.score <= maxScan ? '≤' : '>'} ${maxScan}`, 'soft');
  } else {
    add('deai', 'AI 痕迹', false, '还没有扫描结果', 'soft');
  }

  /* 6. 结尾不能自我总结：那是 AI 最典型的收尾方式 */
  const lastPara = text.trim().split(/\n\s*\n/).pop() ?? '';
  const summary = SUMMARY_SIGNALS.find((s) => lastPara.includes(s));
  add('no-summary', '结尾不总结', !summary, summary ? `末段出现「${summary}」` : '结尾没有总结句');

  return gates;
}

/** 就绪度：设定门 + 已写章节的通过率，给界面一个进度感 */
export function readiness(book) {
  const bg = bookGates(book);
  const pass = bg.filter((g) => g.ok).length;
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const written = chapters.filter((c) => c?.text).length;
  const planned = Array.isArray(book?.outline?.chapters) ? book.outline.chapters.length : 0;
  const clean = chapters.filter((c) => (c?.gates ?? []).every((g) => g.ok)).length;
  return {
    biblePass: pass,
    bibleTotal: bg.length,
    bibleReady: pass === bg.length,
    // 自由写作下设定不全也能写：只是提示「缺什么」，不是前置条件
    freedom: book?.freedom !== false,
    written,
    planned,
    clean,
    progress: planned ? Math.round((written / planned) * 100) : 0,
  };
}
