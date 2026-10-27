// 分工原则（沿用上游开源技能的核心哲学）：
//   结构性、可计算的部分一律交给 engine（gate / stats / render），模型只写创造性文本。
// 这样质量门不会因为模型抽风而失真，评估结论始终可信。
//
// 2026-10-17：剧本「生成」链路已随功能框整体下线——buildOutlinePrompt / generateOutline /
// repairOutline / generateScript / normalizeScriptEpisodes / repairScriptEpisodes /
// continueScript 全部移除（连同 /api/generate 与 /api/continue 路由）。
// 本文件现在只留下游功能要用的确定性能力：评估、优化、估秒、报告、Markdown 导出。
// 剧本从哪来：粘贴/上传解析（/api/split、前端 parseScriptText），或打开历史项目。

import {
  gateReport as scriptGates,
  computeStats,
  renderHtml as renderScriptHtml,
} from '../engine/script.mjs';
import { gateReport as outlineGates } from '../engine/outline.mjs';

// 评估：纯确定性，不调模型。剧本 10 道门 + 大纲 14 道门
export function evaluateScript(script, outline) {
  const gates = scriptGates(script, { outline });
  const oGates = outline ? outlineGates(outline) : [];
  const all = [...gates.map((g) => ({ ...g, scope: 'script' })), ...oGates.map((g) => ({ ...g, scope: 'outline' }))];
  const passed = all.filter((g) => g.ok).length;
  const score = all.length ? Math.round((passed / all.length) * 100) : 0;
  const problems = all.filter((g) => !g.ok);
  return {
    score,
    passed,
    total: all.length,
    gates: all,
    problems,
    stats: computeStats(script),
  };
}

function splitLongLine(line, max) {
  if (line.length <= max) return [line];
  // 按标点切，切不动就按字数硬切
  const parts = [];
  let buf = '';
  for (const ch of line) {
    buf += ch;
    if ('，。！？、；：'.includes(ch) && buf.length >= Math.ceil(max / 2)) {
      parts.push(buf.trim());
      buf = '';
    } else if (buf.length >= max) {
      parts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

/**
 * 确定性优化器：能把「机器可修」的问题直接修好，修不了的给出人工建议。
 * 这一步刻意做成可解释的，避免"优化"变成黑箱重写。
 */
export function autoFixScript(script, problems, params = {}, outline = null) {
  const maxLine = params.maxLineChars ?? 35;
  const actionSeconds = params.actionSeconds ?? 2.5;
  const charsPerSecond = params.charsPerSecond ?? 4.5;
  let changed = 0;
  const remaining = [];
  const notes = [];
  // 角色名 → id：动作里混的对白要拆成台词，能认出说话人就别丢给 VO
  const nameToId = new Map((outline?.characters ?? []).map((c) => [c.name, c.id]));

  const episodes = (script.episodes ?? []).map((ep) => {
    let target = ep.targetSeconds ?? 120;
    const scenes = (ep.scenes ?? []).map((sc) => {
      const flow = [];
      for (const beat of sc.flow ?? []) {
        if (typeof beat.action === 'string') {
          // 动作里夹对白（她冷笑道：“你算什么东西”）会被 action-prose 门拦下。
          // 拆成「动作 + 台词」两条比删引号更保真——台词还能当正戏用。
          const q = /^(.*?)[：:，,、\s]*[「『“]([^」』”]+)[」』”](.*)$/.exec(beat.action);
          if (q) {
            const head = q[1].trim().replace(/[，,、]$/, '');
            const tail = q[3].trim();
            if (head) flow.push({ action: head });
            const speaker = [...nameToId].find(([name]) => head.includes(name))?.[1] ?? 'VO';
            flow.push({ speaker, line: q[2].trim(), delivery: '' });
            if (tail) flow.push({ action: tail });
            changed += 1;
            continue;
          }
          if (/[「」『』“”]/.test(beat.action)) {
            flow.push({ ...beat, action: beat.action.replace(/[「」『』“”]/g, '') });
            changed += 1;
            continue;
          }
          flow.push(beat);
          continue;
        }
        const parts = splitLongLine(beat.line ?? '', maxLine);
        if (parts.length > 1) changed += 1;
        parts.forEach((text, i) => {
          flow.push({
            speaker: beat.speaker,
            line: text,
            delivery: i === 0 ? (beat.delivery ?? '') : '（续）',
          });
        });
      }
      // 纯对白场次补一个动作节拍，杜绝"广播剧"
      if (flow.length > 0 && !flow.some((b) => typeof b.action === 'string')) {
        flow.unshift({ action: '她顿了一下，视线从对方脸上移开。' });
        changed += 1;
      }
      return { ...sc, flow };
    });

    // 时长回补：欠得多的集补动作节拍，超得多的集砍末尾动作
    const est = estimateSeconds({ ...ep, scenes }, { actionSeconds, charsPerSecond });
    const lo = target * 0.85;
    const hi = target * 1.15;
    // 补拍用的动作池：拿本集自己的动作描述接一个短后置动作，
    // 读起来像同一场戏的延续，而不是「同一句话刷三十遍」的机器味。
    // 一集自己的动作越多，可拼出的组合越多，复读感越弱。
    const ownActions = [...new Set(scenes
      .flatMap((sc) => (sc.flow ?? []).filter((b) => typeof b.action === 'string').map((b) => b.action)))];
    const tails = ['停顿了一拍。', '谁都没再开口。', '屋外的响动近了些。', '她把手收了回来。', '这句话没人接。'];
    const fillerAt = (k) => {
      const stem = (ownActions.length ? ownActions[k % ownActions.length] : '她侧过身')
        .replace(/[。！？…]+$/, '').slice(0, 16);
      return { action: `${stem}，${tails[k % tails.length]}` };
    };
    // 缺口可能很大，按需要补的次数算，不给死循环的机会（上限 400 次）
    let fabricated = 0;
    if (est < lo && scenes.length) {
      const need = Math.min(400, Math.ceil((lo - est) / actionSeconds));
      for (let i = 0; i < need; i += 1) {
        scenes[i % scenes.length].flow.push(fillerAt(i));
        fabricated += 1;
        changed += 1;
      }
      // 补拍是兜底不是本事：补得太多说明模型产出不够，如实记一笔，
      // 别让「100 分」把「这一集其实是引擎撑起来的」盖过去
      const total = scenes.reduce((n, sc) => n + (sc.flow ?? []).length, 0);
      notes.push({
        ep: ep.ep,
        fabricated,
        total,
        hint: fabricated / Math.max(1, total) > 0.3
          ? `第 ${ep.ep} 集模型产出不足，${fabricated} 拍由引擎按公式补足，建议重新生成本集`
          : `第 ${ep.ep} 集补足 ${fabricated} 拍`,
      });
    } else if (est > hi) {
      // 超时长的砍法：从最长的场里砍，先砍台词（画面留得住），没有台词了才砍动作。
      // 硬底线是每场至少留 1 个动作——早先的实现按场景下标循环砍、砍到某场一个动作不剩，
      // 把「超时长」直接换成了「广播剧」（踩 has-action 门）。
      const pickIndex = (sc) => {
        const f = sc.flow ?? [];
        const lastLine = [...f].reverse().findIndex((b) => typeof b.line === 'string');
        if (lastLine >= 0) return f.length - 1 - lastLine;
        const nAct = f.filter((b) => typeof b.action === 'string').length;
        if (nAct > 1) return f.length - 1 - [...f].reverse().findIndex((b) => typeof b.action === 'string');
        return -1;
      };
      const estOf = () => estimateSeconds({ ...ep, scenes }, { actionSeconds, charsPerSecond });
      // 删减次数不能按「目标秒数 ÷ 单个动作秒数」预估算——
      // 实际优先删的是台词（约 1.8s/条），预算按 2.5s/拍算是删不够的，
      // 会稳定留下「超 0.2 秒」这种擦边失败。改成边删边复算，删到进带为止。
      const MAX_TRIM = 400;
      let removed = 0;
      while (removed < MAX_TRIM && estOf() > hi) {
        const cands = scenes.filter((sc) => pickIndex(sc) >= 0);
        if (!cands.length) break;
        const sc = cands.sort((a, b) => (b.flow?.length ?? 0) - (a.flow?.length ?? 0))[0];
        sc.flow.splice(pickIndex(sc), 1);
        removed += 1;
        changed += 1;
      }
      if (estOf() > hi) {
        remaining.push({
          id: 'duration',
          detail: removed >= MAX_TRIM
            ? `时长超出且已删至 ${MAX_TRIM} 拍上限`
            : '时长超出，但每场至少留一个动作节拍，已无可删的节拍',
        });
      }
    }
    return { ...ep, scenes };
  });

  const fixed = { ...script, episodes };
  for (const p of problems) {
    if (!['line-length', 'has-action', 'duration', 'action-prose'].includes(p.id)) remaining.push(p);
  }
  return { script: fixed, changed, remaining, notes };
}

export function estimateSeconds(ep, { actionSeconds = 2.5, charsPerSecond = 4.5 } = {}) {
  let total = 0;
  for (const sc of ep.scenes ?? []) {
    for (const beat of sc.flow ?? []) {
      if (beat.action) total += actionSeconds;
      else total += (beat.line ?? '').replace(/\s/g, '').length / charsPerSecond;
    }
  }
  return Math.round(total * 10) / 10;
}

export function renderScriptReport(script, outline) {
  return renderScriptHtml(script, { outline });
}
/** 导出为可读 Markdown：给人审和交付用 */
export function toMarkdown(script, outline) {
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  const out = [`# ${script?.source ?? '漫剧剧本'}`, ''];
  for (const ep of script?.episodes ?? []) {
    out.push(`## 第 ${ep.ep} 集（目标 ${ep.targetSeconds ?? '-'} 秒）`, '');
    if (ep.hook) out.push(`- 开场钩子：${ep.hook}`);
    if (ep.cliff) out.push(`- 结尾悬念：${ep.cliff}`);
    out.push('');
    for (const sc of ep.scenes ?? []) {
      out.push(`### ${sc.sceneId} · ${sc.lighting ?? ''}`, '');
      for (const b of sc.flow ?? []) {
        if (b.action) out.push(b.action);
        else out.push(`${names.get(b.speaker) ?? b.speaker}：${b.line}${b.delivery ? `（${b.delivery}）` : ''}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}
