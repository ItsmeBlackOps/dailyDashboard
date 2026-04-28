import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = process.env.FORGE_MODEL || 'gpt-4o-mini';

let _client;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set. Add it to .env or export it.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`template var missing: ${k}`);
    const v = vars[k];
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

function splitPrompt(md) {
  const sys = md.match(/## System\s*\n([\s\S]*?)\n## User/);
  const usr = md.match(/## User\s*\n([\s\S]*)$/);
  if (!sys || !usr) throw new Error('prompt file must have ## System and ## User sections');
  return { system: sys[1].trim(), user: usr[1].trim() };
}

export function loadPrompt(name) {
  const p = path.join(process.cwd(), 'prompts', name);
  const md = fs.readFileSync(p, 'utf8');
  return splitPrompt(md);
}

export async function callJSON({ agent, prompt, vars, temperature, traceDir }) {
  const system = prompt.system;
  const user = renderTemplate(prompt.user, vars);

  const t0 = Date.now();
  const resp = await client().chat.completions.create({
    model: MODEL,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const ms = Date.now() - t0;

  const raw = resp.choices[0]?.message?.content ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${agent}: non-JSON response: ${raw.slice(0, 400)}`);
  }

  if (traceDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const entry = {
      agent,
      model: MODEL,
      temperature,
      ms,
      usage: resp.usage,
      system,
      user,
      response: parsed,
    };
    fs.appendFileSync(
      path.join(traceDir, 'trace.jsonl'),
      JSON.stringify({ ts: stamp, ...entry }) + '\n'
    );
  }

  return { parsed, usage: resp.usage, ms };
}
