/*
 * 内容体检 —— 结构与时长之外的那一半。
 *
 * 现有的 14 + 10 + 18 道门管的是「形状」（id 合法、引用对账、时长达标、钩子落点），
 * 它们全过 ≠ 剧本好看。这里补的是内容维度里**能确定性判定**的几条：
 * 每一集有没有节奏定位、有没有网文腔、有没有水词、环境描写超没超预算、集间是不是硬切。
 *
 * 定位很重要：**体检只报告、不拦截**。它不改现有质量门的判定，也不阻止生成——
 * 用户看到的是「这几处可能不好看，建议这么改」，而不是又一个红灯。
 * 判据全部来自开源短剧方法体系（Short Drama Script / 情绪弹簧 / 17 条反模式）里
 * 被反复验证的硬规矩，只取我们体量下能确定性实现的部分。
 */

/* ---------------- 词表 ---------------- */

// 环境/氛围词：短剧里环境只允许作为「剧情道具」出现，纯渲染就是废戏
const ENV_WORDS = [
  '阳光', '月光', '灯光', '夜色', '晨雾', '雾气', '雨幕', '大雨', '小雨', '雪花',
  '寒风', '冷风', '微光', '光影', '霓虹', '天空', '云层', '树叶', '风铃', '街景',
  '车流', '人来人往', '寂静', '弥漫', '笼罩', '映照', '投下', '摇曳',
];
// 明显的水词：删掉之后人物关系和情绪毫无变化
const FILLER_LINES = new Set([
  '嗯', '哦', '啊', '好', '是', '对', '行', '谢谢', '明白了', '知道了', '收到', '好的',
  '我知道了', '我明白', '是的', '没错',
]);
// 设问句（旁白替观众提问，是小说腔）
const RHETORICAL_RE = /(难道|是谁|为什么|究竟|到底是谁)[^。！？]{0,20}[？?]/;
// 通感比喻
const METAPHOR_RE = /(仿佛|好似|像是在|像在|如同|宛如)/;
const SUSPENSION_RE = /(……|——)/;

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
const clean = (s) => String(s ?? '').replace(/\s/g, '');
const countEnv = (t) => ENV_WORDS.filter((w) => t.includes(w)).length;

/* ---------------- 单项检查 ---------------- */

/** 1. 节奏定位：每集必须有 spring，序列要合理（这是「好不好看」的第一因） */
function checkSpringPlan(script) {
  const eps = script?.episodes ?? [];
  const hits = [];
  const missing = eps.filter((e) => !['press', 'release', 'both'].includes(e.spring));
  for (const e of missing) {
    hits.push({
      ep: e.ep,
      where: '本集节奏定位',
      text: '',
      why: '这一集没有声明自己是压还是放——节奏定位不明的集就是「既不压也不放」的注水集',
      fix: '给这一集补 spring：press（只压不解决）/ release（给释放）/ both（前半压后半放）',
    });
  }
  // 连续三个 press：观众连看三集没有释放点，会弃剧
  const springs = eps.map((e) => e.spring);
  for (let i = 2; i < springs.length; i += 1) {
    if (springs[i] === 'press' && springs[i - 1] === 'press' && springs[i - 2] === 'press') {
      hits.push({
        ep: eps[i].ep,
        where: '节奏序列',
        text: `第 ${i - 1}、${i}、${i + 1} 集连续三集都是压弹簧`,
        why: '连续三集只压不放，观众看不到任何释放，情绪会疲',
        fix: '把其中一集改成 release 或 both（前半压、后半放）',
      });
    }
  }
  const relieved = springs.filter((s) => s === 'release' || s === 'both').length;
  if (springs.length && relieved / springs.length < 0.3) {
    hits.push({
      ep: null,
      where: '',
      text: `有释放的集只有 ${relieved}/${springs.length} 集`,
      why: '全剧有释放（release 或 both）的集数不足三成，整体偏压抑，缺少爽点落点',
      fix: '至少三成集数安排 release 或 both',
    });
  }
  return { ok: hits.length === 0, hits };
}

/** 2. 网文腔：写小说的腔调，不是写给摄像机的（一票否决级问题） */
function checkWebnovelTone(script) {
  const hits = [];
  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        const t = b.action;
        if (!hasText(t)) continue;
        const s = t.trim();
        if (SUSPENSION_RE.test(s)) {
          hits.push({ ep: ep.ep, where: `第${ep.ep}集 ${sc.sceneId}`, text: s, why: '用省略号/破折号做气口，镜头拍不出来', fix: '停顿改成括号里的表演提示，或换成一句实在的台词' });
        } else if (RHETORICAL_RE.test(s)) {
          hits.push({ ep: ep.ep, where: `第${ep.ep}集 ${sc.sceneId}`, text: s, why: '设问句在替观众提问，是小说腔', fix: '把疑问交给人物当面说出来，或改成一个具体动作' });
        } else if (METAPHOR_RE.test(s) && s.length > 8) {
          hits.push({ ep: ep.ep, where: `第${ep.ep}集 ${sc.sceneId}`, text: s, why: '「仿佛/像是在」式通感比喻，摄像机拍不到', fix: '只写镜头能拍到的客观细节（把「力道很重」改成「纸被笔尖戳破了几个洞」）' });
        }
      }
    }
  }
  return { ok: hits.length === 0, hits };
}

/** 3. 水词：删掉之后关系与情绪毫无变化的台词 */
function checkFillerLines(script) {
  const hits = [];
  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        if (!hasText(b.line)) continue;
        const t = clean(b.line).replace(/[。！？，、…！?,.!]/g, '');
        if (t.length <= 4 && FILLER_LINES.has(t)) {
          hits.push({ ep: ep.ep, where: `第${ep.ep}集 ${sc.sceneId}`, text: `${b.speaker ?? ''}：${b.line}`, why: '纯应答词，删掉人物关系和情绪毫无变化（水词）', fix: '补一个情绪指向 + 一个姿态（谁高谁低、谁在忍），或直接删掉这句' });
        }
      }
    }
  }
  return { ok: hits.length === 0, hits };
}

/** 4. 环境预算：短剧只允许「剧情道具型」环境，不做氛围渲染 */
function checkEnvironmentBudget(script) {
  const hits = [];
  for (const ep of script?.episodes ?? []) {
    let envCount = 0;
    let sample = '';
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        const t = b.action;
        if (!hasText(t)) continue;
        const n = countEnv(t);
        if (n >= 2 && clean(t).length > 16) {
          envCount += 1;
          if (!sample) sample = t;
          if (clean(t).length > 30) {
            hits.push({ ep: ep.ep, where: `第${ep.ep}集 ${sc.sceneId}`, text: t, why: '环境铺陈过长（超过 30 字），短剧没有这个时长做氛围', fix: '只留与剧情有因果的那一句（如「地上有滩水」因为有人要滑倒），其余删掉' });
          }
        }
      }
    }
    if (envCount > 3) {
      hits.push({ ep: ep.ep, where: `第${ep.ep}集`, text: sample, why: `本集有 ${envCount} 处环境描写，超出每集 2 句的预算`, fix: '环境只保留剧情必需的那一两句，其余交给镜头语言' });
    }
  }
  return { ok: hits.length === 0, hits };
}

/** 5. 集间承接：第 2 集起开头要接住上一集的场景或人物，不能凭空硬切 */
function checkCarryOver(script) {
  const hits = [];
  const eps = script?.episodes ?? [];
  for (let i = 1; i < eps.length; i += 1) {
    const prev = eps[i - 1];
    const cur = eps[i];
    const prevLast = (prev.scenes ?? [])[(prev.scenes ?? []).length - 1];
    const curFirst = (cur.scenes ?? [])[0];
    if (!prevLast || !curFirst) continue;
    const sameScene = prevLast.sceneId && prevLast.sceneId === curFirst.sceneId;
    const prevCast = new Set(prevLast.characters ?? []);
    const sharedCast = (curFirst.characters ?? []).some((c) => prevCast.has(c));
    const declared = ['time', 'scene', 'state', 'unit'].includes(cur.carryFrom);
    if (!sameScene && !sharedCast && !declared) {
      hits.push({
        ep: cur.ep,
        where: `第${cur.ep}集开头`,
        text: `${curFirst.sceneId} 与上一集结尾（${prevLast.sceneId}）既不同场、也没有共同角色`,
        why: '集与集之间像硬切，观众读完上集钩子，下集开头完全跳脱（像单元剧）',
        fix: '本集开头补一句时间锚定（几小时后/次日），或沿用上一集的场景/人物状态接下去',
      });
    }
  }
  return { ok: hits.length === 0, hits };
}

/* ---------------- 汇总 ---------------- */

const CHECKS = [
  { id: 'spring-plan', label: '节奏定位', run: checkSpringPlan, weight: 3 },
  { id: 'no-webnovel-tone', label: '网文腔', run: checkWebnovelTone, weight: 3 },
  { id: 'no-filler-line', label: '水词', run: checkFillerLines, weight: 2 },
  { id: 'environment-budget', label: '环境预算', run: checkEnvironmentBudget, weight: 1 },
  { id: 'carry-over', label: '集间承接', run: checkCarryOver, weight: 2 },
];

/**
 * 内容体检：只报告不拦截。
 * @returns {{ score, passed, total, checks: Array }}
 */
export function contentCheck(script) {
  const checks = CHECKS.map((c) => {
    let r;
    try {
      r = c.run(script);
    } catch (err) {
      r = { ok: false, hits: [{ ep: null, where: c.label, text: '', why: `体检项执行失败：${err.message}`, fix: '（这一项跳过）' }] };
    }
    return { id: c.id, label: c.label, ok: r.ok, hits: r.hits, weight: c.weight };
  });
  const totalWeight = checks.reduce((n, c) => n + c.weight, 0);
  const okWeight = checks.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0);
  return {
    score: totalWeight ? Math.round((okWeight / totalWeight) * 100) : 100,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    // 只把有问题的段落列出来，前端直接按这个顺序展示
    problems: checks.filter((c) => !c.ok),
  };
}
