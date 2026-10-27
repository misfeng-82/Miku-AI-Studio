/* 角色识别：从剧本里抽出「这一部戏有哪些人」，并给出可被提示词引用的编号。
 *
 * 为什么不直接用 outline.characters：解析器会把「只在一集里开口」的人并进「群演」桶
 * （资产层只需要一张松散参考图），于是一集里的三四个主角会变成同一个 C03。
 * 真正的人名留在每个台词节拍的 delivery 里（"贺铭瑄 推卸责任"），这里就从那儿抽。
 *
 * 规则：
 *   ① 名字来源：台词 delivery 的第一段 > outline.characters 里有名字的角色（补无台词者）
 *   ② 编号：按首次出场顺序发 C01、C02…；群演桶不占号，归到「未命名」里
 *   ③ 身份：优先用 outline 里的 role/desc；没有就按职业词猜（护士/保姆/医生…）
 *   ④ 别名：只认描述里的「又名/又称/小名/外号/化名：」，亲属称呼不自动合并
 */
import { lineChars } from '../engine/script.mjs';

const UNNAMED = /^(护士|医生|保姆|护工|助理|秘书|保安|司机|服务员|服务生|宾客|客人|路人|群演|管家|警察|律师|记者|员工|同事|保镖|主持|司仪|店主|老板|邻居|前台|销售|店员|工人)/;
const TONE = /^(冷笑|嘲讽|嗤笑|反驳|质问|心寒|失落|心酸|虚弱|愤怒|温柔|敷衍|讨好|附和|得意|害怕|警惕|疑惑|无奈|叹气|认真|补充|放轻声音|压低声音|低声|高声|沉声|哽咽|颤抖|平静|淡淡|笑|哭|喊|吼|冷笑一声)/;

/** "贺铭瑄 推卸责任" / "阿莲" / "船客 低声" → "贺铭瑄" */
export function nameOfDelivery(delivery) {
  const raw = String(delivery ?? '').replace(/（[^）]*）/g, '').replace(/\b(os|vo|OS|VO)\b/g, '');
  const first = raw.trim().split(/[\s　]+/)[0] ?? '';
  // 只接受「像人名」的 2–4 字中文：生成链路的 delivery 是语气词（低声/冷笑），不是名字
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(first)) return '';
  if (first === '群演' || TONE.test(first)) return '';
  return first;
}

const firstSentence = (s) => String(s ?? '').split(/[。；;，,]/)[0]?.slice(0, 28) ?? '';

export function analyzeCast(script, outline) {
  const episodes = script?.episodes ?? [];
  const outlineChars = (outline?.characters ?? []).filter((c) => c?.name && c.name !== '群演');
  const byName = new Map(outlineChars.map((c) => [c.name, c]));

  const order = [];
  const stat = new Map(); // name → {lines, words, episodes:Set, scenes:Set, unnamed}
  const touch = (name) => {
    if (!stat.has(name)) { stat.set(name, { lines: 0, words: 0, episodes: new Set(), scenes: new Set() }); order.push(name); }
    return stat.get(name);
  };

  for (const ep of episodes) {
    (ep.scenes ?? []).forEach((sc, si) => {
      for (const b of sc.flow ?? []) {
        if (typeof b?.line !== 'string' || !b.line.trim()) continue;
        // 名字优先级：角色表里该 id 的真名（非群演）> delivery（导入剧本被并进群演桶时才用）
        const fromTable = (outline?.characters ?? []).find((c) => c.id === b.speaker && c.name !== '群演')?.name ?? '';
        const fromDelivery = nameOfDelivery(b.delivery);
        const name = fromTable || fromDelivery;
        if (!name) continue; // 纯群演台词：不占角色号
        const s = touch(name);
        s.lines += 1;
        s.words += lineChars(b.line);
        s.episodes.add(ep.ep);
        s.scenes.add(`E${ep.ep}-${si + 1}`);
      }
    });
  }
  // 只在人物表里、没开口的人也要登场（保姆、路人这类）
  for (const c of outlineChars) if (!stat.has(c.name)) { touch(c.name); }

  const characters = order.map((name, i) => {
    const c = byName.get(name) ?? null;
    const s = stat.get(name);
    const desc = String(c?.desc ?? '');
    const aliasHit = /(?:又名|又称|小名|外号|化名)[：:]\s*([^，。；]+)/.exec(desc);
    const aliases = aliasHit ? aliasHit[1].split(/[、,，/]/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
    const unnamed = UNNAMED.test(name) || name.length <= 1;
    const role = c?.role && c.role !== '功能性角色' ? c.role : (unnamed ? '功能性角色' : '配角');
    const identity = [role, firstSentence(desc) && firstSentence(desc) !== name ? firstSentence(desc) : '']
      .filter(Boolean).join(' · ').slice(0, 48);
    return {
      id: `C${String(i + 1).padStart(2, '0')}`,
      name,
      aliases,
      role,
      identity,
      unnamed,
      lines: s.lines,
      words: s.words,
      episodes: [...s.episodes].sort((a, b) => a - b),
      scenes: [...s.scenes],
    };
  }).sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id));

  // 重排后 id 要跟名字绑定（前面按台词数排过序）
  characters.forEach((c, i) => { c.id = `C${String(i + 1).padStart(2, '0')}`; });

  const named = characters.filter((c) => !c.unnamed);
  const unnamed = characters.filter((c) => c.unnamed);
  const silent = characters.filter((c) => c.lines === 0);
  const notes = [];
  if (characters.some((c) => c.aliases.length)) notes.push('描述里写了「又名/又称」，已并入 aliases；正文和提示词仍用编号引用。');
  if (unnamed.length) notes.push(`${unnamed.length} 个未命名角色（${unnamed.map((c) => c.name).join('、')}）：按身份设定外观，不编造姓名。`);
  if (silent.length) notes.push(`${silent.length} 个角色只在人物表里、没有台词（${silent.map((c) => c.name).join('、')}）：可作背景人物，不单独占子镜头。`);
  notes.push('「爸/妈/哥/姐」等亲属称呼不自动合并到具体角色：需要合并时在角色描述里写「又名：××」。');

  return {
    characters,
    summary: { total: characters.length, named: named.length, unnamed: unnamed.length, lines: characters.reduce((n, c) => n + c.lines, 0) },
    notes,
  };
}

/** name（含别名）→ 编号：模型写名字也能对回 C 号 */
export function castNameMap(cast) {
  const m = new Map();
  for (const c of cast?.characters ?? []) {
    m.set(c.name, c.id);
    for (const a of c.aliases ?? []) m.set(a, c.id);
  }
  return m;
}

/** 写进拆分提示词的角色表：编号 / 名字 / 别名 / 身份 / 出场 / 台词 */
export function castPromptBlock(cast) {
  const rows = (cast?.characters ?? []).map((c) => {
    const alias = c.aliases.length ? `（又称 ${c.aliases.join('/')}）` : '';
    const where = c.episodes.length ? `出场：第 ${c.episodes.join('、')} 集` : '只在人物表里';
    const kind = c.unnamed ? '未命名·按身份设定' : `台词 ${c.lines} 句`;
    return `- ${c.id}｜${c.name}${alias}｜${c.identity || c.role}｜${where}｜${kind}`;
  });
  return [
    '【角色表（自动识别，引用时只写编号）】',
    ...rows,
    '',
    '规则：',
    '1. 同一角色的不同称呼已合并，正文与提示词一律用编号（如 C03），不要写名字或称谓。',
    '2. 标「未命名」的角色按身份合理设定外观（护士=护士服、宾客=礼服），不要编姓名。',
    '3. 没有台词的背景人物只在需要时入镜，不单独占一个子镜头。',
  ].join('\n');
}
