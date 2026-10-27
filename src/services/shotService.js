/* 分镜拆分服务 v2：一集剧本 → 15 秒分镜段 → 段内子镜头 + 段提示词。
 *
 * 流程（与生成链路同一套纪律）：
 *   ① 只喂这一集（整稿进来模型会偷懒：漏集、砍场）
 *   ② 要 JSON，走 completeJson（重试 + 五级 JSON 修复）
 *   ③ 归一化：段号/段时长/子镜秒数/景别/运镜/台词归位全由引擎兜住
 *   ④ 过 11 道结构门，不过门把「段号 + 具体错误」贴回去重修一轮
 *   ⑤ 模型彻底不可用（402 / 超时 / 返回不可解析）时**降级到规则切段**：
 *      台词一句不丢、每段 15 秒、段提示词按时间轴拼出来，下游照常能导出
 */
import { createHash } from 'node:crypto';
import { completeJson, status as llmStatus } from '../agent/llm.js';
import { logger } from '../logger.js';
import { badRequest } from '../errors.js';
import { episodeText } from '../assets/scriptRender.js';
import { SPLIT_SYSTEM, buildSplitUser } from '../assets/shotSpec.js';
import { stylePromptSuffix } from '../assets/stylePresets.js';
import { analyzeCast, castPromptBlock } from './castService.js';
import {
  normalizeSegments, gateReport, deterministicSegments, buildAnchors, anchorsFromCast,
  boardStats, flattenShots, sizeLabel, moveLabel,
} from '../engine/shots.mjs';

/** 台词语气：子镜头没给 tone 时，从剧本 delivery 取。
 *  解析后「贺铭瑄（推卸责任）：」变成 delivery="贺铭瑄 推卸责任"——第二段就是语气/动作。
 *  排除纯名字/OS/VO 这类不是语气的第二段。 */
const TONE_WORDS = /^(冷笑|嘲讽|嗤笑|反驳|质问|心寒|失落|心酸|虚弱|愤怒|温柔|敷衍|讨好|附和|得意|害怕|警惕|疑惑|无奈|叹气|认真|补充|放轻声音|压低声音|低声|高声|沉声|哽咽|颤抖|平静|淡淡|严肃|着急|急促|哀求|哭|笑|喊|吼)/;
function toneOf(shot, episode) {
  if (shot?.tone) return shot.tone;
  const line = shot?.line ?? '';
  for (const sc of episode?.scenes ?? []) {
    for (const b of sc.flow ?? []) {
      if (b?.line?.trim() !== line) continue;
      const parts = String(b.delivery ?? '').replace(/[（(）)]/g, ' ').trim().split(/\s+/);
      const tone = parts[1] ?? '';
      if (tone && TONE_WORDS.test(tone)) return tone;
      return '';
    }
  }
  return '';
}

/** 场景名：sceneIndex → 大纲/解析里的场景名 */
function sceneNameOf(episode, sceneIndex) {
  return episode?.scenes?.[sceneIndex - 1]?.name ?? `第 ${sceneIndex} 场`;
}

const REPAIR_ROUNDS = 1;
/** 同一集 + 同一参数拆过一次就不再花钱：命中缓存直接返回（含重修结果） */
const CACHE_MAX = 24;
const splitCache = new Map();
const cacheKeyOf = (ep, text, castIds, styleId, aspect) => createHash('sha1')
  .update(`${ep}|${text}|${castIds}|${styleId}|${aspect}`).digest('hex');

const gateText = (gates) => gates.filter((g) => !g.ok)
  .map((g) => `- ${g.label}${g.detail ? `：${g.detail}` : ''}`).join('\n');

/** 一集 → 分镜段 */
export async function splitEpisode({ script, outline, ep, styleId, aspect = '9:16' } = {}) {
  const started = Date.now();
  const no = Number(ep) || 1;
  const episode = (script?.episodes ?? []).find((e) => e.ep === no);
  if (!episode) throw badRequest(`剧本里没有第 ${no} 集`);
  const eps = script.episodes ?? [];
  const entry = (outline?.episodes ?? []).find((e) => e.ep === no) ?? null;
  // 角色识别优先：从台词 delivery 抽出真名，再建编号与外观表
  const cast = analyzeCast(script, outline);
  const anchors = anchorsFromCast(cast);
  const castBlock = castPromptBlock(cast);
  // 给模型的外观短语不带名字：它一旦照抄，no-name 门就会拦下来
  const chars = [...anchors.entries()].map(([id, v]) => ({ id, name: v.name, anchor: v.look || v.name }));
  const prev = eps.find((e) => e.ep === no - 1) ?? null;
  // 本集台词（供模型对账，也让 mock 样本能造出"一句不丢"的结构）
  const lines = (episode.scenes ?? []).flatMap((sc) => (sc.flow ?? [])
    .filter((b) => typeof b.line === 'string' && b.line.trim())
    .map((b) => ({ speaker: b.speaker ?? '', line: b.line.trim() })));
  const llm = llmStatus();
  const cacheKey = cacheKeyOf(no, episodeText(episode, outline), cast.characters.map((c) => `${c.id}:${c.name}`).join(','), styleId ?? '', aspect);
  const cached = splitCache.get(cacheKey);
  if (cached) {
    logger.info('shots.split.cache', { ep: no, ms: Date.now() - started });
    return { ...cached, cached: true };
  }

  const ctx = {
    ep: no,
    totalEps: eps.length,
    targetSeconds: Number(episode.targetSeconds) || 75,
    sceneCount: episode.scenes?.length ?? 1,
    episodeText: episodeText(episode, outline),
    entry,
    chars,
    lines,
    castBlock,
    prevSummary: prev?.cliff ? `上一集结尾：${prev.cliff}` : '',
    prevEnding: prev?.cliff ?? '',
    styleLine: styleId ? stylePromptSuffix(styleId) : '',
    aspect,
  };

  let segments = [];
  let gates = [];
  let error = '';
  let rounds = 0;

  for (let round = 0; round <= REPAIR_ROUNDS; round += 1) {
    rounds = round + 1;
    try {
      const raw = await completeJson({
        system: SPLIT_SYSTEM,
        user: buildSplitUser({ ...ctx, repair: round === 0 ? '' : gateText(gates) }),
        // 分镜输出长、单次就要几十秒：只重试 1 次，避免 3 次 × 超时把用户拖到几分钟
        attempts: 2,
      });
      segments = normalizeSegments(raw, { ep: no, episode, outline, anchors, cast });
      for (const seg of segments) {
        for (const sh of seg.shots ?? []) sh.tone = sh.tone || toneOf(sh, episode);
      }
      gates = gateReport(segments, { episode, outline, cast });
      if (segments.length && gates.every((g) => g.ok)) { error = ''; break; }
      error = segments.length
        ? gates.filter((g) => !g.ok).map((g) => `${g.label}：${g.detail}`).join('；')
        : '模型没有返回任何分镜段';
      logger.warn('shots.gates', { ep: no, round, failed: gates.filter((g) => !g.ok).map((g) => g.id) });
    } catch (e) {
      // 传输/解析/余额问题：不再重试，直接记录原因走降级
      error = e.message;
      segments = [];
      logger.warn('shots.call.fail', { ep: no, round, reason: e.message });
      break;
    }
  }

  let degraded = false;
  if (!segments.length) {
    degraded = true;
    segments = deterministicSegments(episode, outline, { ep: no, cast });
    gates = gateReport(segments, { episode, outline, cast });
    logger.info('shots.degraded', { ep: no, segments: segments.length, reason: error.slice(0, 120) });
  }

  const result = {
    ep: no,
    segments,
    shots: flattenShots(segments), // 平铺版：给按镜消费的下游
    cast, // 识别到的角色（含别名/未命名/出场段落）
    stats: boardStats(segments),
    gates,
    passed: gates.every((g) => g.ok),
    degraded,
    error,
    rounds,
    llm: { mode: llm.mode, model: llm.model },
    cached: false,
  };
  splitCache.set(cacheKey, result);
  if (splitCache.size > CACHE_MAX) splitCache.delete(splitCache.keys().next().value);
  logger.info('shots.split', {
    ep: no, ms: Date.now() - started, rounds, degraded, segments: result.stats.segments, shots: result.stats.shots,
  });
  return result;
}

/* ---------------- 导出 ---------------- */
export function boardMarkdown({ ep = 1, segments = [], styleId = '' } = {}) {
  const segs = segments ?? [];
  const shots = flattenShots(segs);
  const out = [
    `# 第 ${ep} 集 分镜（${segs.length} 段 / ${shots.length} 镜 / ${boardStats(segs).seconds}s）`,
    '',
  ];
  for (const seg of segs) {
    out.push(`## ${seg.id} · ${seg.sec}s${seg.beat ? ` · ${seg.beat}` : ''} · 第 ${seg.sceneIndex} 场`);
    out.push('');
    out.push('| 镜号 | 时长 | 景别 | 运镜 | 画面 | 台词 | 光线 |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const s of seg.shots ?? []) {
      out.push(`| ${s.id} | ${s.sec}s | ${sizeLabel(s.size)} | ${moveLabel(s.move)} | ${s.visual.replace(/\|/g, '／')} | ${(s.line || '—').replace(/\|/g, '／')} | ${(s.lighting || '—').replace(/\|/g, '／')} |`);
    }
    out.push('');
    out.push('**15 秒提示词**');
    out.push('');
    out.push('```');
    out.push(seg.prompt);
    out.push('```');
    out.push('');
  }
  out.push(`<!-- style: ${styleId || 'default'} -->`);
  return out.join('\n');
}

export function boardJson({ ep = 1, segments = [], styleId = '', aspect = '9:16' } = {}) {
  return JSON.stringify({ ep, styleId, aspect, segments }, null, 2);
}

/** 供前端显示"预计段数" */
export function estimateSegments(targetSeconds) {
  return Math.max(1, Math.round((Number(targetSeconds) || 75) / 15));
}
