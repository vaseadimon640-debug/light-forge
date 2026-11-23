import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { localize, type QuickRfq, type RfqLanguage } from '../rfq/quick.ts';
import type { Photo } from '../domain/project.ts';

export type OriginalPhoto = { metadata: Photo; bytes: Uint8Array };
export class PdfBusy extends Error {}
export class InvalidPhoto extends Error {}
export class PdfUnavailable extends Error {}

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
let browserPromise: Promise<Browser> | undefined;
let jobs = 0;

function openBrowser() {
  if (!browserPromise) {
    const launching = chromium.launch({ headless: true, executablePath, timeout: 20_000 });
    browserPromise = launching;
    const reset = () => { if (browserPromise === launching) browserPromise = undefined; };
    void launching.then(browser => { browser.on('disconnected', reset); }, reset);
  }
  return browserPromise;
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function html(model: QuickRfq, photos: OriginalPhoto[], language: RfqLanguage) {
  const show = (cell: Parameters<typeof localize>[0]) => escape(localize(cell, language));
  const tableCell = (cell: Parameters<typeof localize>[0]) => {
    if (language !== 'en-zh' || typeof cell === 'string' || cell[0] === cell[1]) return show(cell);
    const separator = ' · ';
    const [english, chinese] = cell;
    const prefix = english.slice(0, english.indexOf(separator) + separator.length);
    const sharedMeasurement = /^[-0-9].* · $/.test(prefix) && chinese.startsWith(prefix);
    return `${escape(english)} <span lang="zh-CN">/ ${escape(sharedMeasurement ? chinese.slice(prefix.length) : chinese)}</span>`;
  };
  const figures = photos.map(({ metadata, bytes }, index) => {
    const url = `data:${metadata.type};base64,${Buffer.from(bytes).toString('base64')}`;
    return `<figure class="${index === 0 ? 'primary' : ''}">
      <img src="${url}" alt="${escape(metadata.name)}"><figcaption>${escape(metadata.name)}</figcaption>
    </figure>`;
  });
  return `<!doctype html>
<html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<title>${escape(model.title)} — LIGHT FORGE</title>
<style>
  @page { size: A4; margin: 15mm 15mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 9.2pt/1.35 Arial, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif; color: #20282b; }
  header { padding-bottom: 10pt; margin-bottom: 11pt; border-bottom: 2px solid #263c42; break-inside: avoid; }
  .brand { font-size: 9pt; font-weight: bold; letter-spacing: .15em; color: #284c57; margin: 0 0 5pt; }
  h1 { font-size: 20pt; line-height: 1.17; margin: 0 0 4pt; white-space: pre-line; overflow-wrap: anywhere; }
  .project { font-size: 12pt; margin: 0; overflow-wrap: anywhere; }
  .subtitle { color: #394e56; margin: 4pt 0 0; font-size: 8pt; white-space: pre-line; }
  h2 { font-size: 10pt; color: #243e46; margin: 0 0 4pt; white-space: pre-line; overflow-wrap: anywhere; break-after: avoid; }
  section { margin: 0 0 9pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 2.3pt 4pt; text-align: left; vertical-align: top; border-bottom: .5pt solid #cad7d9; white-space: pre-line; overflow-wrap: anywhere; }
  th { width: 41%; font-weight: 600; }
  tr { break-inside: avoid; }
  tr:nth-child(odd) { background: #f4f7f7; }
  figure { margin: 0 0 6pt; break-inside: avoid; min-width: 0; }
  img { display: block; width: 100%; height: 38mm; object-fit: contain; object-position: center left; }
  .primary img { height: 75mm; }
  figcaption { margin-top: 3pt; font-size: 8pt; color: #394e56; overflow-wrap: anywhere; }
  .additional { display: flex; flex-wrap: wrap; gap: 4%; }
  .additional figure { width: 48%; }
  .missing { color: #394e56; white-space: pre-line; margin: 0 0 8pt; }
  .requests { margin: 0; padding-inline-start: 14pt; }
  .requests li { margin-bottom: 4pt; white-space: pre-line; break-inside: avoid; overflow-wrap: anywhere; }
</style></head><body>
<header><p class="brand">LIGHT FORGE</p><h1>${show(model.documentTitle)}</h1>
<p class="project">${escape(model.title)}</p><p class="subtitle">${show(model.subtitle)}</p></header>
<section><h2>${show(model.photoTitle)}</h2>
${figures.length ? figures[0] + `<div class="additional">${figures.slice(1).join('')}</div>` : `<p class="missing">${show(model.noPhoto)}</p>`}
</section>
${model.sections.map(({ title, rows }) => `<section>
<h2>${show(title)}</h2><table><tbody>${rows.map(([name, value]) =>
  `<tr><th scope="row">${tableCell(name)}</th><td>${tableCell(value)}</td></tr>`).join('')}</tbody></table></section>`).join('')}
<section><h2>${show(model.requestTitle)}</h2>
<ul class="requests">${model.requested.map(item => `<li>${show(item)}</li>`).join('')}</ul></section>
</body></html>`;
}

export async function renderRfqPdf(model: QuickRfq, photos: OriginalPhoto[], language: RfqLanguage): Promise<Uint8Array<ArrayBuffer>> {
  if (jobs >= 2) throw new PdfBusy('PDF renderer is busy.');
  jobs += 1;
  try {
    let browser: Browser;
    try { browser = await openBrowser(); } catch { throw new PdfUnavailable('Chromium is unavailable.'); }
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      await page.setContent(html(model, photos, language), { waitUntil: 'load', timeout: 20_000 });
      if (await page.locator('img').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth === 0)))
        throw new InvalidPhoto('Chromium could not decode one of the supplied images.');
      await page.evaluate(() => document.fonts.ready.then(() => true));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new PdfUnavailable('PDF generation timed out.')), 20_000);
        });
        const printed = await Promise.race([
          page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }),
          deadline,
        ]);
        return new Uint8Array(printed);
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      await context.close();
    }
  } finally {
    jobs -= 1;
  }
}
