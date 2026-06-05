// Synthesizer strategies. Both produce Skill IR(s) from a session's events.
//  - rule-based: deterministic, offline, zero-dependency.
//  - llm:        starts from the rule-based IR, then asks Claude to improve the
//                naming / description / parameter boundaries. Falls back to
//                rule-based on any error or missing API key.
import { segment, correlate } from './correlate.js';
import { buildIR } from './ir.js';
import { ANTHROPIC_API_KEY, LLM_MODEL } from './config.js';

export function synthesizeRuleBased(events) {
  const tasks = segment(events);
  return tasks.map((task) => buildIR(task, correlate(task), { generatedBy: 'rule-based' }));
}

export async function synthesize(events, engine = 'rule') {
  const base = synthesizeRuleBased(events);
  if (engine !== 'llm' || !ANTHROPIC_API_KEY) return base;

  const refined = [];
  for (const ir of base) {
    try {
      refined.push(await refineWithLLM(ir));
    } catch (err) {
      refined.push({ ...ir, generatedBy: `rule-based (llm failed: ${err.message})` });
    }
  }
  return refined;
}

async function refineWithLLM(ir) {
  const prompt = [
    '你是一个把"浏览器操作录制"转写为可复用技能(skill)的助手。',
    '下面是规则引擎从一次真实操作中抽取的 Skill IR(JSON)。',
    '请在不改变 steps 结构与字段名的前提下，优化以下内容：',
    '1) name：用简洁的动宾短语概括这个任务；',
    '2) description：一句话说明这个技能完成什么；',
    '3) parameters[].name：改成更语义化的名字，并同步替换 steps 中对应的 {占位符}。',
    '只返回一个 JSON 对象，结构与输入完全一致，不要任何解释或 markdown 代码块。',
    '',
    'Skill IR:',
    JSON.stringify(ir, null, 2),
  ].join('\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  const json = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(json);
  return { ...ir, ...parsed, generatedBy: `llm:${LLM_MODEL}` };
}
