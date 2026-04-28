import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'templates');

export async function listTemplates() {
  const files = fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.js')).sort();
  const out = [];
  for (const f of files) {
    const mod = await import(`./templates/${f}`);
    out.push({ file: f, ...mod.meta });
  }
  return out;
}

export async function renderHTML(templateId, resume) {
  const file = fs.readdirSync(TEMPLATE_DIR).find(f => f.startsWith(templateId));
  if (!file) throw new Error(`template not found: ${templateId}`);
  const mod = await import(`./templates/${file}`);
  return mod.render(resume);
}
