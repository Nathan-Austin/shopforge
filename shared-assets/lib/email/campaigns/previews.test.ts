import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../orderConfirmation';
import { resolveEmailTmpDir, writeEmailTmpFile } from '../tmpDir';
import { sampleContext, sampleDocument } from './fixtures';
import { EMAIL_WIDTH, renderCampaign } from './render';

/**
 * Renders the sample campaign in a few locales and writes it to
 * `$EMAIL_TMP_DIR/previews/`, with an index page showing each one at
 * desktop and phone width side by side. Open
 * `/tmp/sf-<name>-email-builder/previews/index.html` to eyeball a change
 * to the renderer. Nothing is written outside that directory.
 */

const LOCALES = ['en', 'de', 'ar'];
const PHONE_WIDTH = 375;

describe('campaign previews', () => {
  const resolved = resolveEmailTmpDir();

  it('has a valid preview directory', () => {
    expect(resolved).toMatchObject({ ok: true });
  });

  it.runIf(resolved.ok)('writes desktop and phone previews per locale', async () => {
    const frames: string[] = [];
    for (const locale of LOCALES) {
      const result = renderCampaign(sampleDocument(), sampleContext({ locale }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      await writeEmailTmpFile('previews', `campaign-sample-${locale}.html`, result.email.html);
      await writeEmailTmpFile('previews', `campaign-sample-${locale}.txt`, result.email.text);
      const srcdoc = escapeHtml(result.email.html);
      frames.push(`<section>
  <h2>${escapeHtml(locale)}: ${escapeHtml(result.email.subject)}</h2>
  <p>${result.email.warnings.length} warning(s): ${escapeHtml(result.email.warnings.map((w) => `${w.code}${w.blockId ? `@${w.blockId}` : ''}`).join(', ') || 'none')}</p>
  <div class="row">
    <iframe title="${escapeHtml(locale)} desktop" width="${EMAIL_WIDTH + 40}" height="900" srcdoc="${srcdoc}"></iframe>
    <iframe title="${escapeHtml(locale)} phone" width="${PHONE_WIDTH}" height="900" srcdoc="${srcdoc}"></iframe>
  </div>
</section>`);
    }
    const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Campaign previews</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#e7e5e4}.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}iframe{border:1px solid #a8a29e;background:#fff}</style>
</head><body><h1>Campaign previews: desktop (${EMAIL_WIDTH}px) and phone (${PHONE_WIDTH}px)</h1>
${frames.join('\n')}
</body></html>`;
    const indexPath = await writeEmailTmpFile('previews', 'index.html', index);
    if (resolved.ok) expect(indexPath).toBe(`${resolved.dir}/previews/index.html`);
    expect(await readFile(indexPath, 'utf8')).toContain('<iframe title="ar phone"');
  });
});
