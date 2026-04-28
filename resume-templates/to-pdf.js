import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export function htmlToPDF(htmlPath, pdfPath) {
  // Edge prints from file:// URLs only. Convert path.
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ], { stdio: 'pipe' });
  return pdfPath;
}
