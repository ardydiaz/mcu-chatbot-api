const fs = require('fs/promises');
const pdfParse = require('pdf-parse');

const pageBreak = '\n\n---PDF_PAGE_BREAK---\n\n';

async function renderPage(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });

  let lastY;
  let text = '';

  for (const item of textContent.items) {
    if (lastY === item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }

    lastY = item.transform[5];
  }

  return `${text}${pageBreak}`;
}

async function extractTextByPage(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer, {
    pagerender: renderPage
  });

  const pages = data.text
    .split(pageBreak)
    .slice(0, data.numpages)
    .map((content, index) => ({
      pageNumber: index + 1,
      content: content.trim()
    }));

  if (pages.length === 0) {
    return Array.from({ length: data.numpages }, (_, index) => ({
      pageNumber: index + 1,
      content: ''
    }));
  }

  return pages;
}

module.exports = {
  extractTextByPage
};
