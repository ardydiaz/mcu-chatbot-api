function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function tryLoadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function normalizeTextLines(value) {
  const cleanedLines = [];
  const seenLines = new Set();

  String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .forEach((line) => {
      const normalizedLine = line.toLowerCase();

      if (isNavigationLine(line) || seenLines.has(normalizedLine)) {
        return;
      }

      seenLines.add(normalizedLine);
      cleanedLines.push(line);
    });

  return cleanedLines;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const numericCode = Number(code);

      return Number.isFinite(numericCode) ? String.fromCharCode(numericCode) : ' ';
    });
}

function stripHtmlNoise(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<div[^>]*(?:id|class)=["'][^"']*(?:menu|navbar|nav-|site-header|site-footer|sidebar|breadcrumb|social|cookie|modal|popup|newsletter|search|elementor-location-header|elementor-location-footer)[^"']*["'][\s\S]*?<\/div>/gi, ' ')
    .replace(/<section[^>]*(?:id|class)=["'][^"']*(?:menu|navbar|nav-|site-header|site-footer|sidebar|breadcrumb|social|cookie|modal|popup|newsletter|search)[^"']*["'][\s\S]*?<\/section>/gi, ' ');
}

function extractTagContent(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(html || '').match(pattern);

  return match?.[1] || '';
}

function getLargestMatch(html, pattern) {
  const matches = [...String(html || '').matchAll(pattern)]
    .map((match) => match[1] || '')
    .filter((content) => content.length > 300)
    .sort((first, second) => second.length - first.length);

  return matches[0] || '';
}

function extractContentContainer(html) {
  const mainContent = extractTagContent(html, 'main');

  if (mainContent.length > 300) {
    return mainContent;
  }

  const articleContent = extractTagContent(html, 'article');

  if (articleContent.length > 300) {
    return articleContent;
  }

  const elementorContent = getLargestMatch(
    html,
    /<(?:div|section)[^>]*(?:data-elementor-type=["']wp-page["']|data-elementor-type=["']wp-post["'])[^>]*>([\s\S]*?)<\/(?:div|section)>/gi
  );

  if (elementorContent.length > 300) {
    return elementorContent;
  }

  const contentClass = getLargestMatch(
    html,
    /<(?:div|section)[^>]*(?:id|class)=["'][^"']*(?:entry-content|page-content|post-content|main-content|elementor-widget-theme-post-content|site-content|content-area)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi
  );

  if (contentClass.length > 300) {
    return contentClass;
  }

  return html;
}

function extractTitle(html, fallbackUrl) {
  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const headingMatch = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch?.[1] || headingMatch?.[1] || fallbackUrl;

  return decodeHtmlEntities(title.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function annotateLinks(html, pageUrl) {
  return String(html || '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (fullMatch, attributes, innerHtml) => {
    const hrefMatch = String(attributes || '').match(/\bhref\s*=\s*["']([^"']+)["']/i);

    if (!hrefMatch) {
      return fullMatch;
    }

    const label = decodeHtmlEntities(String(innerHtml || '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();

    try {
      const linkedUrl = new URL(hrefMatch[1], pageUrl);

      if (!/^https?:$/i.test(linkedUrl.protocol)) {
        return label || fullMatch;
      }

      linkedUrl.hash = '';
      const normalizedUrl = linkedUrl.toString();

      if (!label || label === normalizedUrl) {
        return normalizedUrl;
      }

      return `${label}: ${normalizedUrl}`;
    } catch {
      return label || fullMatch;
    }
  });
}

function extractReadableText(html, pageUrl = '') {
  const focusedHtml = extractContentContainer(html);
  const text = stripHtmlNoise(annotateLinks(focusedHtml, pageUrl))
    .replace(/<\/(h1|h2|h3|h4|p|li|div|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeTextLines(decodeHtmlEntities(text)).join('\n').trim();
}

function isNavigationLine(line) {
  const normalized = String(line || '').toLowerCase().replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return true;
  }

  const exactNoise = new Set([
    'skip to content',
    'student\'s resources',
    'students resources',
    'covid-19 info',
    'facebook',
    'instagram',
    'twitter',
    'x',
    'youtube',
    'linkedin',
    'enroll now',
    'search',
    'menu',
    'close',
    'read more',
    'home',
    'about mcu',
    'our history',
    'purpose, mission, vision',
    'quality policy',
    'our manifesto',
    'board of trustees',
    'why mcu',
    'mcu partners',
    'accreditation and certifications',
    'careers at mcu',
    'university directory',
    'privacy policy',
    'academic',
    'preschool',
    'grade school',
    'junior high school',
    'senior high school',
    'colleges',
    'national service training program',
    'institutional research office',
    'admission & aid',
    'apply online',
    'admission procedures',
    'admission requirements',
    'scholarships & grants',
    'payment options',
    'latest at mcu',
    'news',
    'events',
    'centralino stories',
    'centralino life',
    'campus festivities',
    'arts, culture, & immersion',
    'athletics & team spirit',
    'community & giving',
    'sustainability programs',
    'i am centralino',
    'alumni website',
    'resources',
    'library',
    'online admmission application',
    'online admission application',
    'student access module',
    'faculty access module',
    'online registrar\'s office'
  ]);

  if (exactNoise.has(normalized)) {
    return true;
  }

  if (/^(facebook|instagram|twitter|youtube|linkedin)\b/i.test(normalized)) {
    return true;
  }

  if (/^(previous|next|previous slide|next slide|back to top|share this|follow us)$/i.test(normalized)) {
    return true;
  }

  if (/^manila central university, edsa, caloocan city/i.test(normalized)) {
    return true;
  }

  if (/^\(\+632\)\s*8364-10-71/i.test(normalized)) {
    return true;
  }

  if (/^\[email\s*protected\]$/i.test(normalized)) {
    return true;
  }

  if (/^copyright\b|^©\s*manila central university/i.test(normalized)) {
    return true;
  }

  return false;
}

function extractSameOriginLinks(html, pageUrl, rootOrigin) {
  const links = [];
  const seen = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html))) {
    try {
      const url = new URL(match[1], pageUrl);
      url.hash = '';

      if (url.origin !== rootOrigin || !/^https?:$/i.test(url.protocol)) {
        continue;
      }

      if (/\.(pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|webp|zip)$/i.test(url.pathname)) {
        continue;
      }

      const normalizedUrl = url.toString();

      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        links.push(normalizedUrl);
      }
    } catch {
      // Ignore malformed href values.
    }
  }

  return links;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'MCU-Chatbot-Knowledge-Importer/1.0'
    }
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error(`Unable to crawl ${url}: HTTP ${response.status}`);
  }

  if (!contentType.includes('text/html')) {
    throw new Error(`Skipped non-HTML page: ${url}`);
  }

  return response.text();
}

function mergeTextBlocks(blocks) {
  const lines = [];
  const seen = new Set();

  for (const block of blocks) {
    for (const line of normalizeTextLines(block)) {
      const key = line.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      lines.push(line);
    }
  }

  return lines.join('\n').trim();
}

async function markInteractiveElements(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll([
      'button',
      'a',
      '[role="button"]',
      '[data-bs-toggle]',
      '[data-toggle]',
      '[aria-controls]',
      '.accordion-button'
    ].join(',')));

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    }

    const interactiveTextPattern = /\b(qualifications?|requirements?|terms?|conditions?|details?|read more|learn more|view more|view details|more info|apply|procedure|guidelines?)\b/i;

    return candidates
      .map((element) => ({
        element,
        text: (element.innerText || element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      }))
      .filter(({ element, text }) => isVisible(element) && text.length > 1 && text.length <= 90 && interactiveTextPattern.test(text))
      .slice(0, 40)
      .map(({ element, text }, index) => {
        element.setAttribute('data-mcu-crawler-click', String(index));
        return { index, text };
      });
  });
}

async function extractVisibleBrowserText(page) {
  const bodyText = await page.evaluate(() => {
    const main = document.querySelector('main, article, .entry-content, .page-content, .post-content, .elementor-widget-theme-post-content, .site-content, .content-area');
    const root = main || document.body;

    function annotateAnchor(element) {
      const label = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();

      if (!element.href) {
        return label;
      }

      if (!label || label === element.href) {
        return element.href;
      }

      return `${label}: ${element.href}`;
    }

    const clone = root.cloneNode(true);
    const originalAnchors = Array.from(root.querySelectorAll('a[href]'));
    const clonedAnchors = Array.from(clone.querySelectorAll('a[href]'));

    clonedAnchors.forEach((anchor, index) => {
      const replacement = document.createElement('span');
      replacement.textContent = annotateAnchor(originalAnchors[index] || anchor);
      anchor.replaceWith(replacement);
    });

    return clone.innerText || clone.textContent || '';
  });

  return mergeTextBlocks([bodyText]);
}

async function extractDialogText(page) {
  return page.evaluate(() => {
    const selectors = [
      '.modal.show',
      '.modal[style*="display: block"]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.elementor-popup-modal',
      '.mfp-content',
      '.swal2-container',
      '.popup',
      '.dialog'
    ];

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    }

    function annotateLinks(element) {
      const clone = element.cloneNode(true);
      const originalAnchors = Array.from(element.querySelectorAll('a[href]'));
      const clonedAnchors = Array.from(clone.querySelectorAll('a[href]'));

      clonedAnchors.forEach((anchor, index) => {
        const originalAnchor = originalAnchors[index] || anchor;
        const label = (originalAnchor.innerText || originalAnchor.textContent || '').replace(/\s+/g, ' ').trim();
        const replacement = document.createElement('span');
        replacement.textContent = !label || label === originalAnchor.href
          ? originalAnchor.href
          : `${label}: ${originalAnchor.href}`;
        anchor.replaceWith(replacement);
      });

      return clone.innerText || clone.textContent || '';
    }

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(isVisible)
      .map(annotateLinks)
      .join('\n');
  });
}

async function extractHiddenInteractiveText(page) {
  return page.evaluate(() => {
    const selectors = [
      '.modal',
      '[role="dialog"]',
      '[aria-modal]',
      '.elementor-popup-modal',
      '.mfp-content',
      '.popup',
      '.dialog',
      '.accordion-collapse',
      '.accordion-content',
      '.accordion-body',
      '.tab-pane',
      '[data-tab-content]'
    ];

    function annotateLinks(element) {
      const clone = element.cloneNode(true);
      const originalAnchors = Array.from(element.querySelectorAll('a[href]'));
      const clonedAnchors = Array.from(clone.querySelectorAll('a[href]'));

      clonedAnchors.forEach((anchor, index) => {
        const originalAnchor = originalAnchors[index] || anchor;
        const label = (originalAnchor.innerText || originalAnchor.textContent || '').replace(/\s+/g, ' ').trim();
        const replacement = document.createElement('span');
        replacement.textContent = !label || label === originalAnchor.href
          ? originalAnchor.href
          : `${label}: ${originalAnchor.href}`;
        anchor.replaceWith(replacement);
      });

      return clone.innerText || clone.textContent || '';
    }

    const seen = new Set();

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .map(annotateLinks)
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 30)
      .filter((text) => {
        const key = text.toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .join('\n');
  });
}

async function closeVisibleDialog(page) {
  const closeSelectors = [
    '.modal.show [data-bs-dismiss="modal"]',
    '.modal.show [data-dismiss="modal"]',
    '.modal.show .btn-close',
    '.modal.show .close',
    '[role="dialog"] [aria-label="Close"]',
    '.elementor-popup-modal [aria-label="Close"]',
    '.mfp-close'
  ];

  for (const selector of closeSelectors) {
    try {
      const closeButton = page.locator(selector).first();

      if (await closeButton.count()) {
        await closeButton.click({ timeout: 1000 });
        await page.waitForTimeout(200);
        return;
      }
    } catch {
      // Try the next close option.
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
}

async function crawlInteractivePage(url) {
  const playwright = tryLoadPlaywright();

  if (!playwright?.chromium) {
    return null;
  }

  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: 'MCU-Chatbot-Knowledge-Importer/1.0'
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    const title = await page.title();
    const textBlocks = [
      await extractVisibleBrowserText(page),
      await extractHiddenInteractiveText(page)
    ];
    const interactiveElements = await markInteractiveElements(page);

    for (const item of interactiveElements) {
      try {
        const locator = page.locator(`[data-mcu-crawler-click="${item.index}"]`).first();

        if (!await locator.count()) {
          continue;
        }

        await locator.click({ timeout: 2500, force: true });
        await page.waitForTimeout(500);

        const dialogText = await extractDialogText(page);
        const visibleText = await extractVisibleBrowserText(page);
        const extractedText = mergeTextBlocks([
          item.text ? `${item.text}` : '',
          dialogText,
          visibleText
        ]);

        if (extractedText) {
          textBlocks.push(extractedText);
        }

        await closeVisibleDialog(page);
      } catch {
        // Some buttons may navigate, require auth, or be blocked by page scripts.
      }
    }

    const content = mergeTextBlocks(textBlocks);

    if (content.length < 80) {
      return null;
    }

    return {
      url,
      title: title || url,
      content,
      textPreview: content.length > 700 ? `${content.slice(0, 700)}...` : content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      extractionMode: interactiveElements.length > 0 ? 'browser-interactive' : 'browser',
      interactiveItemsFound: interactiveElements.length
    };
  } finally {
    await browser.close();
  }
}

async function crawlWebsite({ url, maxPages = 20, allowedPathPrefix = '', followLinks = true }) {
  const startUrl = normalizeUrl(url);

  if (!startUrl || !isHttpUrl(startUrl)) {
    throw new Error('A valid website URL is required.');
  }

  const root = new URL(startUrl);
  const queue = [startUrl];
  const visited = new Set();
  const pages = [];
  const pageLimit = Math.max(1, Math.min(Number(maxPages) || 20, 50));
  const notes = [];

  if (!tryLoadPlaywright()) {
    notes.push('Interactive modal/tab extraction requires Playwright. Static HTML extraction was used.');
  }

  while (queue.length > 0 && pages.length < pageLimit) {
    const currentUrl = queue.shift();

    if (!currentUrl || visited.has(currentUrl)) {
      continue;
    }

    visited.add(currentUrl);

    try {
      const html = await fetchHtml(currentUrl);
      let interactivePage = null;

      if (!followLinks && tryLoadPlaywright()) {
        try {
          interactivePage = await crawlInteractivePage(currentUrl);
        } catch (error) {
          notes.push(`Interactive extraction failed for ${currentUrl}: ${error.message}`);
        }
      }

      const text = interactivePage?.content || extractReadableText(html, currentUrl);

      if (text.length >= 80) {
        pages.push(interactivePage || {
          url: currentUrl,
          title: extractTitle(html, currentUrl),
          content: text,
          textPreview: text.length > 700 ? `${text.slice(0, 700)}...` : text,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          extractionMode: 'static'
        });
      }

      if (!followLinks) {
        continue;
      }

      const links = extractSameOriginLinks(html, currentUrl, root.origin);

      for (const link of links) {
        const parsedLink = new URL(link);

        if (allowedPathPrefix && !parsedLink.pathname.startsWith(allowedPathPrefix)) {
          continue;
        }

        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    } catch {
      // Keep crawling other pages even when one URL fails.
    }
  }

  return {
    startUrl,
    origin: root.origin,
    extractionMode: pages.some((page) => page.extractionMode === 'browser-interactive')
      ? 'browser-interactive'
      : 'static',
    notes,
    pages
  };
}

module.exports = {
  crawlWebsite,
  normalizeUrl
};
