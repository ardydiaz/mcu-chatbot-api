const { crawlWebsite } = require('../services/websiteCrawlerService');
const { normalizeScope } = require('../services/scopeService');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWordParagraphs(content) {
  return String(content || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .join('\n');
}

function buildWordHtml({ title, siteScope, pages }) {
  const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const toc = pages.map((page, index) => (
    `<li>${escapeHtml(index + 1)}. ${escapeHtml(page.title || page.url)}</li>`
  )).join('\n');
  const pageSections = pages.map((page, index) => (
    `<section>
      <h2>${escapeHtml(index + 1)}. ${escapeHtml(page.title || page.url)}</h2>
      ${buildWordParagraphs(page.content)}
    </section>`
  )).join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #1f2937; line-height: 1.5; }
    h1 { color: #3b0a57; font-size: 24pt; margin-bottom: 6pt; }
    h2 { color: #3b0a57; font-size: 16pt; margin-top: 22pt; border-bottom: 1px solid #ddd; padding-bottom: 4pt; }
    p { font-size: 11pt; margin: 0 0 10pt; }
    ul { margin-top: 8pt; }
    li { margin-bottom: 4pt; }
    .meta, .source { color: #667085; font-size: 10pt; }
    section { page-break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta"><strong>Scope:</strong> ${escapeHtml(siteScope)}</p>
  <p class="meta"><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
  <h2>Pages Included</h2>
  <ul>${toc}</ul>
  ${pageSections}
</body>
</html>`;
}

function buildDownloadFilename(title) {
  const cleaned = String(title || 'website-import')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${cleaned || 'website-import'}.doc`;
}

async function previewWebsiteImport(req, res, next) {
  try {
    const crawlResult = await crawlWebsite({
      url: req.body.url,
      maxPages: req.body.maxPages,
      allowedPathPrefix: req.body.allowedPathPrefix || '',
      followLinks: req.body.followLinks === true || req.body.followLinks === 'true'
    });

    return res.json(crawlResult);
  } catch (error) {
    return next(error);
  }
}

async function exportWebsiteImportWord(req, res, next) {
  try {
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const selectedUrls = Array.isArray(req.body.selectedUrls) ? req.body.selectedUrls : [];
    const crawlResult = await crawlWebsite({
      url: req.body.url,
      maxPages: req.body.maxPages,
      allowedPathPrefix: req.body.allowedPathPrefix || '',
      followLinks: req.body.followLinks === true || req.body.followLinks === 'true'
    });
    const selectedUrlSet = new Set(selectedUrls);
    const pages = selectedUrlSet.size > 0
      ? crawlResult.pages.filter((page) => selectedUrlSet.has(page.url))
      : crawlResult.pages;

    if (pages.length === 0) {
      return res.status(400).json({ message: 'No crawled pages were selected for export.' });
    }

    const title = String(req.body.title || `Website Import - ${crawlResult.origin}`).trim();
    const html = buildWordHtml({
      title,
      siteScope,
      pages
    });

    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildDownloadFilename(title)}"`);
    return res.send(html);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  previewWebsiteImport,
  exportWebsiteImportWord
};
