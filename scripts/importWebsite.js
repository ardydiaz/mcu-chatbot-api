// Imports the public content of the MCU website (https://mcu.edu.ph) into the knowledge base.
//
// Each website page becomes a document, the same as an uploaded file: its text is saved
// as a .txt file in the uploads folder, stored in document_text for keyword search, and
// indexed in Qdrant for semantic search. documents.source_url links the document back to
// the website page so answers can show where the information came from.
//
// Re-running the script updates changed pages, skips unchanged ones and removes pages
// that no longer exist on the website.
//
// Usage:
//   node scripts/importWebsite.js                  pages, academic programs, Centralino pages
//   node scripts/importWebsite.js --include-news   also the news posts
//   node scripts/importWebsite.js --dry-run        fetch and convert only, no database writes
//   node scripts/importWebsite.js --force          re-save and re-index unchanged pages too

const fs = require('fs/promises');
const https = require('https');
const path = require('path');
const pool = require('../src/utils/db');
const { qdrantApiKey, qdrantCollection, qdrantUrl, uploadDir } = require('../src/config/env');
const { deleteDocumentVectors, indexDocumentPages, isQdrantEnabled } = require('../src/services/qdrantService');

const SITE_URL = 'https://mcu.edu.ph';
const USER_AGENT = 'Mozilla/5.0 (compatible; MCU-Chatbot-Indexer/1.0)';
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_DELAY_MS = 300;
const MIN_TEXT_LENGTH = 150;
const MAX_PAGE_CHARS = 3000;
const SITE_SCOPE = 'general';
const WEBSITE_DIR = path.join(uploadDir, 'website');

const CONTENT_TYPES = [
  { restBase: 'pages', category: 'MCU Website: Pages' },
  { restBase: 'academic', category: 'MCU Website: Academics' },
  { restBase: 'centralino', category: 'MCU Website: Centralino' },
  { restBase: 'posts', category: 'MCU Website: News', optionalFlag: '--include-news' }
];

// Pages that duplicate other content or only hold layout.
const SKIPPED_SLUGS = new Set(['home-2']);

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const isForced = args.has('--force');

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', ntilde: 'ñ', Ntilde: 'Ñ', eacute: 'é'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }

    return NAMED_ENTITIES[code] ?? entity;
  });
}

// Turns WordPress/Elementor HTML into plain text, one block per line,
// with "- " list items and a blank line before each heading.
function htmlToText(html) {
  const marked = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|iframe|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n§H§')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/?(p|div|section|article|header|footer|ul|ol|li|tr|table|thead|tbody|h[1-6]|blockquote|figure|figcaption|dl|dt|dd)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const lines = decodeEntities(marked)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter((line) => line && line !== '-' && line !== '§H§');

  const output = [];
  let previous = '';

  for (const line of lines) {
    const isHeading = line.startsWith('§H§');
    const clean = line.replace(/^§H§\s*/, '');

    // Elementor repeats tab titles and some widgets back to back.
    if (clean === previous) {
      continue;
    }

    if (isHeading && output.length) {
      output.push('');
    }

    output.push(clean);
    previous = clean;
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Splits long text into ~MAX_PAGE_CHARS "pages" at blank lines, so search hits
// point at the relevant part of a long website page.
function splitIntoPages(title, text) {
  const blocks = text.split(/\n{2,}/);
  const pages = [];
  let current = '';

  for (const block of blocks) {
    if (current && (current.length + block.length + 2) > MAX_PAGE_CHARS) {
      pages.push(current);
      current = '';
    }

    if (block.length > MAX_PAGE_CHARS) {
      const lines = block.split('\n');

      for (const line of lines) {
        if (current && (current.length + line.length + 1) > MAX_PAGE_CHARS) {
          pages.push(current);
          current = '';
        }

        current = current ? `${current}\n${line}` : line;
      }

      continue;
    }

    current = current ? `${current}\n\n${block}` : block;
  }

  if (current) {
    pages.push(current);
  }

  // Repeat the page title on every part so keyword search finds each one by topic.
  return pages.map((content, index) => ({
    pageNumber: index + 1,
    content: index === 0 ? content : `${title} (continued)\n\n${content}`
  }));
}

// Uses the https module instead of fetch: the website's Cloudflare protection
// rejects Node's built-in fetch (undici) with 403 but accepts plain https requests.
function httpsGet(url, accept) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      timeout: REQUEST_TIMEOUT_MS
    }, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }

        resolve({ body, headers: response.headers });
      });
    });

    request.on('timeout', () => request.destroy(new Error(`Timed out: ${url}`)));
    request.on('error', reject);
  });
}

async function withRetries(task) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }

      await sleep(1000 * attempt);
    }
  }

  return null;
}

async function fetchJson(url) {
  return withRetries(async () => {
    const { body, headers } = await httpsGet(url, 'application/json');

    return {
      data: JSON.parse(body),
      totalPages: Number(headers['x-wp-totalpages']) || 1
    };
  });
}

// Some pages (the academic programs) are built from a page template, so the API returns
// little or no content. For those, read the published page and keep the part between
// the site header and the footer / "related posts" loop.
async function fetchRenderedPageText(url) {
  const { body } = await withRetries(() => httpsGet(url, 'text/html'));
  const headerIndex = body.indexOf('data-elementor-type="header"');
  const contentMatch = /data-elementor-type="(single[^"]*|wp-page|wp-post|archive)"/.exec(body.slice(Math.max(headerIndex, 0)));

  if (!contentMatch) {
    return '';
  }

  const contentIndex = Math.max(headerIndex, 0) + contentMatch.index;
  const endIndexes = ['data-elementor-type="loop-item"', 'data-elementor-type="footer"']
    .map((marker) => body.indexOf(marker, contentIndex))
    .filter((index) => index > contentIndex);
  const endIndex = endIndexes.length ? Math.min(...endIndexes) : body.length;
  const html = body.slice(body.lastIndexOf('<', contentIndex), body.lastIndexOf('<', endIndex));

  return htmlToText(html);
}

async function fetchAllItems(restBase) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${SITE_URL}/wp-json/wp/v2/${restBase}?per_page=50&page=${page}&orderby=modified&order=desc&_fields=id,slug,link,title,content,modified`;
    const result = await fetchJson(url);

    items.push(...result.data);
    totalPages = result.totalPages;
    page += 1;
    await sleep(REQUEST_DELAY_MS);
  } while (page <= totalPages);

  return items;
}

async function toWebsiteDocument(item, contentType) {
  const title = decodeEntities(item.title?.rendered || item.slug).replace(/\s+/g, ' ').trim();
  let text = htmlToText(item.content?.rendered);

  if (text.length < MIN_TEXT_LENGTH && !item.content?.protected && !SKIPPED_SLUGS.has(item.slug)) {
    try {
      const renderedText = await fetchRenderedPageText(item.link);

      if (renderedText.length > text.length) {
        text = renderedText;
      }
    } catch (error) {
      console.warn(`  warn   could not read ${item.link}: ${error.message}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const fullText = `${title}\n\n${text}`;

  return {
    wpId: item.id,
    slug: item.slug,
    url: item.link,
    title: title.slice(0, 255),
    category: contentType.category,
    fileName: `${contentType.restBase}-${item.id}.txt`,
    fullText,
    pages: splitIntoPages(title, fullText),
    skipReason: item.content?.protected
      ? 'password protected'
      : SKIPPED_SLUGS.has(item.slug)
        ? 'skipped slug'
        : text.length < MIN_TEXT_LENGTH
          ? 'too little text'
          : null
  };
}

async function getDefaultApiAccountId() {
  const [rows] = await pool.execute(
    'SELECT id FROM api_account WHERE email = ? LIMIT 1',
    ['api-account@mcu.local']
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await pool.execute(
    `INSERT INTO api_account (name, email, password, role, approval_status)
     VALUES (?, ?, NULL, ?, ?)`,
    ['Default API Account', 'api-account@mcu.local', 'admin', 'approved']
  );

  return result.insertId;
}

async function qdrantRequest(pathname, body) {
  const response = await fetch(new URL(pathname, qdrantUrl), {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(qdrantApiKey ? { 'api-key': qdrantApiKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Qdrant ${response.status}`);
  }

  return response.json();
}

async function assertQdrantReachable() {
  try {
    await qdrantRequest('/collections');
  } catch (error) {
    throw new Error(`Qdrant is not reachable at ${qdrantUrl} (${error.cause?.code || error.message}). Start Qdrant, then run the import again.`);
  }
}

// A page whose text is unchanged still needs re-indexing if an earlier run
// stopped before its vectors were saved.
async function hasDocumentVectors(documentId) {
  if (!isQdrantEnabled()) {
    return true;
  }

  try {
    const data = await qdrantRequest(`/collections/${encodeURIComponent(qdrantCollection)}/points/count`, {
      exact: true,
      filter: { must: [{ key: 'documentId', match: { value: Number(documentId) } }] }
    });

    return (data.result?.count || 0) > 0;
  } catch {
    return false;
  }
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function saveWebsiteDocument(doc, existing, uploadedBy) {
  const filePath = path.join(WEBSITE_DIR, doc.fileName);
  const connection = await pool.getConnection();
  let documentId = existing?.id;

  await fs.writeFile(filePath, doc.fullText, 'utf8');

  try {
    await connection.beginTransaction();

    if (documentId) {
      await connection.execute(
        `UPDATE documents
         SET title = ?, file_path = ?, preview_file_path = NULL, topic_category = ?, site_scope = ?
         WHERE id = ?`,
        [doc.title, filePath, doc.category, SITE_SCOPE, documentId]
      );
      await connection.execute('DELETE FROM document_text WHERE document_id = ?', [documentId]);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO documents (title, file_path, source_url, site_scope, topic_category, show_as_topic, uploaded_by)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [doc.title, filePath, doc.url, SITE_SCOPE, doc.category, uploadedBy]
      );
      documentId = result.insertId;
    }

    for (const page of doc.pages) {
      await connection.execute(
        'INSERT INTO document_text (document_id, content, page_number) VALUES (?, ?, ?)',
        [documentId, page.content, page.pageNumber]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (existing && existing.file_path !== filePath) {
    await fs.rm(existing.file_path, { force: true });
  }

  await deleteDocumentVectors(documentId);
  const indexResult = await indexDocumentPages({
    documentId,
    title: doc.title,
    siteScope: SITE_SCOPE,
    pages: doc.pages
  });

  return { documentId, chunks: indexResult.indexed || 0 };
}

async function removeWebsiteDocument(row) {
  await deleteDocumentVectors(row.id);
  await pool.execute('DELETE FROM documents WHERE id = ?', [row.id]);
  await fs.rm(row.file_path, { force: true });
}

async function importContentType(contentType, uploadedBy, totals) {
  console.log(`\n== ${contentType.category} (${contentType.restBase}) ==`);

  const items = await fetchAllItems(contentType.restBase);
  const docs = [];
  const keptUrls = new Set();

  console.log(`Fetched ${items.length} items.`);

  for (const item of items) {
    docs.push(await toWebsiteDocument(item, contentType));
  }

  for (const doc of docs) {
    if (doc.skipReason) {
      console.log(`  skip   ${doc.url} (${doc.skipReason})`);
      totals.skipped += 1;
      continue;
    }

    keptUrls.add(doc.url);

    if (isDryRun) {
      console.log(`  found  ${doc.title} — ${doc.fullText.length} chars, ${doc.pages.length} part(s)`);
      continue;
    }

    const [rows] = await pool.execute(
      'SELECT id, file_path FROM documents WHERE source_url = ? LIMIT 1',
      [doc.url]
    );
    const existing = rows[0];

    if (existing && !isForced) {
      const savedText = await readFileIfExists(existing.file_path);

      if (savedText === doc.fullText && await hasDocumentVectors(existing.id)) {
        totals.unchanged += 1;
        continue;
      }
    }

    const result = await saveWebsiteDocument(doc, existing, uploadedBy);
    totals[existing ? 'updated' : 'added'] += 1;
    totals.chunks += result.chunks;
    console.log(`  ${existing ? 'update' : 'add   '} #${result.documentId} ${doc.title} (${doc.pages.length} part(s), ${result.chunks} vectors)`);
  }

  if (isDryRun) {
    return;
  }

  // Remove documents for pages that are no longer published on the website.
  const [savedRows] = await pool.execute(
    'SELECT id, source_url, file_path, title FROM documents WHERE topic_category = ? AND source_url IS NOT NULL',
    [contentType.category]
  );

  for (const row of savedRows) {
    if (!keptUrls.has(row.source_url)) {
      await removeWebsiteDocument(row);
      totals.removed += 1;
      console.log(`  remove #${row.id} ${row.title} (no longer on the website)`);
    }
  }
}

async function main() {
  const contentTypes = CONTENT_TYPES.filter((type) => !type.optionalFlag || args.has(type.optionalFlag));
  const totals = { added: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0, chunks: 0 };

  if (!isDryRun) {
    await fs.mkdir(WEBSITE_DIR, { recursive: true });

    if (isQdrantEnabled()) {
      await assertQdrantReachable();
    } else {
      console.warn('Qdrant is disabled: website pages will only be found by keyword search.');
    }
  }

  const uploadedBy = isDryRun ? null : await getDefaultApiAccountId();

  for (const contentType of contentTypes) {
    await importContentType(contentType, uploadedBy, totals);
  }

  console.log(
    `\nWebsite import ${isDryRun ? 'dry run ' : ''}complete: ${totals.added} added, ${totals.updated} updated, ` +
    `${totals.unchanged} unchanged, ${totals.removed} removed, ${totals.skipped} skipped, ${totals.chunks} vectors indexed.`
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Website import failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = { htmlToText, splitIntoPages };
