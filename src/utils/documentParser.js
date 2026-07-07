const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { extractTextByPage } = require('./pdfParser');

const inflateRaw = promisify(zlib.inflateRaw);

function decodeXmlEntities(value) {
  return value
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const numericCode = Number(code);

      return Number.isFinite(numericCode) ? String.fromCharCode(numericCode) : ' ';
    });
}

function looksLikeHtmlDocument(content) {
  return /<!doctype html|<html\b|xmlns:o=["']urn:schemas-microsoft-com:office:office/i.test(content);
}

function decodePossiblyUtf16(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.swap16().toString('utf16le');
  }

  return buffer.toString('utf8');
}

function htmlToText(html) {
  const withoutNoise = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<xml[\s\S]*?<\/xml>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<meta[^>]*>/gi, ' ')
    .replace(/<link[^>]*>/gi, ' ')
    .replace(/<\/(h1|h2|h3|h4|h5|h6|p|li|div|section|article|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return stripWordLayoutArtifacts(
    decodeXmlEntities(withoutNoise)
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((line) => !/^\d+\.$/.test(line))
      .filter((line) => !isHtmlDocumentNoiseLine(line))
      .join('\n')
  );
}

function getHtmlBody(html) {
  return String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
}

function htmlToTextPages(html) {
  const body = getHtmlBody(html);
  const sections = body
    .replace(/<\/section>\s*<section>/gi, '\n')
    .split(/(?=<h2\b[^>]*>)/i)
    .map((section) => htmlToText(section))
    .filter((section) => section.length >= 80);

  const pages = sections.length > 1 ? sections : [htmlToText(html)].filter(Boolean);

  return pages.map((content, index) => ({
    pageNumber: index + 1,
    content
  }));
}

function isHtmlDocumentNoiseLine(line) {
  const normalized = String(line || '').toLowerCase().replace(/\s+/g, ' ').trim();

  return /^(previous|next|previous slide|next slide|back to top|share this|follow us)$/i.test(normalized);
}

function stripWordLayoutArtifacts(value) {
  return value
    .replace(/\b(?:left|right|center|margin|width|height|top|bottom)\d+\b/gi, '')
    .replace(/\b\d{6,}\b/g, '')
    .split('\n')
    .map((line) => {
      const leadingWhitespace = line.match(/^[ \t]*/)?.[0].replace(/\t/g, '  ') || '';
      const content = line.slice(line.match(/^[ \t]*/)?.[0].length || 0).replace(/[ \t]{2,}/g, ' ');
      return `${leadingWhitespace}${content}`.trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toAlphabeticCounter(value, uppercase = false) {
  let number = value;
  let result = '';

  while (number > 0) {
    number -= 1;
    result = String.fromCharCode(97 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }

  return uppercase ? result.toUpperCase() : result;
}

function toRomanCounter(value, uppercase = false) {
  const numerals = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i']
  ];
  let number = value;
  let result = '';

  numerals.forEach(([amount, numeral]) => {
    while (number >= amount) {
      result += numeral;
      number -= amount;
    }
  });

  return uppercase ? result.toUpperCase() : result;
}

function formatCounter(value, format) {
  if (format === 'lowerLetter') {
    return toAlphabeticCounter(value);
  }

  if (format === 'upperLetter') {
    return toAlphabeticCounter(value, true);
  }

  if (format === 'lowerRoman') {
    return toRomanCounter(value);
  }

  if (format === 'upperRoman') {
    return toRomanCounter(value, true);
  }

  return String(value);
}

function getXmlAttribute(xml, tagName, attributeName) {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*${attributeName}="([^"]+)"`))?.[1];
}

function parseNumberingDefinitions(numberingXml) {
  const abstractNums = new Map();
  const nums = new Map();

  if (!numberingXml) {
    return { abstractNums, nums };
  }

  const abstractPattern = /<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
  let abstractMatch;

  while ((abstractMatch = abstractPattern.exec(numberingXml)) !== null) {
    const [, abstractNumId, abstractXml] = abstractMatch;
    const levels = new Map();
    const levelPattern = /<w:lvl\b[^>]*w:ilvl="([^"]+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
    let levelMatch;

    while ((levelMatch = levelPattern.exec(abstractXml)) !== null) {
      const [, level, levelXml] = levelMatch;

      levels.set(level, {
        format: getXmlAttribute(levelXml, 'w:numFmt', 'w:val') || 'decimal',
        text: getXmlAttribute(levelXml, 'w:lvlText', 'w:val') || `%${Number(level) + 1}.`,
        start: Number(getXmlAttribute(levelXml, 'w:start', 'w:val') || 1)
      });
    }

    abstractNums.set(abstractNumId, levels);
  }

  const numPattern = /<w:num\b[^>]*w:numId="([^"]+)"[^>]*>([\s\S]*?)<\/w:num>/g;
  let numMatch;

  while ((numMatch = numPattern.exec(numberingXml)) !== null) {
    const [, numId, numXml] = numMatch;
    const abstractNumId = getXmlAttribute(numXml, 'w:abstractNumId', 'w:val');

    if (abstractNumId) {
      nums.set(numId, abstractNumId);
    }
  }

  return { abstractNums, nums };
}

function getNumberLevelDefinition(numberingDefinitions, numId, level) {
  const abstractNumId = numberingDefinitions.nums.get(numId);
  const abstractNum = abstractNumId ? numberingDefinitions.abstractNums.get(abstractNumId) : null;

  return abstractNum?.get(level);
}

function getNumberedParagraphPrefix(paragraphXml, numberingState, numberingDefinitions) {
  const numId = paragraphXml.match(/<w:numId\b[^>]*w:val="([^"]+)"/)?.[1];
  const explicitLevel = Number(paragraphXml.match(/<w:ilvl\b[^>]*w:val="([^"]+)"/)?.[1] || 0);
  const leftIndent = Number(paragraphXml.match(/<w:ind\b[^>]*w:left="([^"]+)"/)?.[1] || 0);
  const indentLevel = leftIndent > 0 ? Math.max(0, Math.round(leftIndent / 720) - 1) : 0;
  const level = String(Math.max(explicitLevel, indentLevel));

  if (!numId) {
    return '';
  }

  const key = `${numId}:${level}`;
  const levelDefinition = getNumberLevelDefinition(numberingDefinitions, numId, level);
  const startValue = levelDefinition?.start || 1;
  const currentValue = numberingState.has(key) ? numberingState.get(key) + 1 : startValue;
  const currentLevel = Number(level);

  [...numberingState.keys()].forEach((stateKey) => {
    const [, stateLevel] = stateKey.split(':');

    if (Number(stateLevel) > currentLevel) {
      numberingState.delete(stateKey);
    }
  });

  numberingState.set(key, currentValue);
  const marker = formatCounter(currentValue, levelDefinition?.format);

  return `${'  '.repeat(currentLevel)}${marker}. `;
}

function getParagraphText(paragraphXml, numberingState, numberingDefinitions) {
  const textParts = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let match;

  while ((match = tokenPattern.exec(paragraphXml)) !== null) {
    if (match[1] !== undefined) {
      textParts.push(decodeXmlEntities(match[1]));
      continue;
    }

    if (match[0].startsWith('<w:tab')) {
      textParts.push('\t');
      continue;
    }

    textParts.push('\n');
  }

  const paragraphText = textParts.join('');
  const numberPrefix = getNumberedParagraphPrefix(paragraphXml, numberingState, numberingDefinitions);

  if (!numberPrefix) {
    return paragraphText;
  }

  if (/^\s*(?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)]\s+/.test(paragraphText)) {
    const indentation = numberPrefix.match(/^\s*/)?.[0] || '';
    return `${indentation}${paragraphText.trimStart()}`;
  }

  return `${numberPrefix}${paragraphText}`;
}

function getParagraphsFromXml(xml, numberingState = new Map(), numberingDefinitions = parseNumberingDefinitions()) {
  const paragraphs = [];
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let match;

  while ((match = paragraphPattern.exec(xml)) !== null) {
    const paragraphText = getParagraphText(match[1], numberingState, numberingDefinitions).trimEnd();

    if (paragraphText.trim()) {
      paragraphs.push(paragraphText);
    }
  }

  return paragraphs;
}

function formatTableCellText(cellXml, numberingState, numberingDefinitions) {
  return getParagraphsFromXml(cellXml, numberingState, numberingDefinitions)
    .map((paragraph) => {
      const leadingWhitespace = paragraph.match(/^[ \t]*/)?.[0].replace(/\t/g, '  ') || '';
      const content = paragraph.slice(paragraph.match(/^[ \t]*/)?.[0].length || 0)
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      return `${leadingWhitespace}${content}`.trimEnd();
    })
    .filter((paragraph) => paragraph.trim())
    .join('\n');
}

function formatTableText(tableXml, numberingDefinitions) {
  const rows = [];
  const rowPattern = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  const numberingState = new Map();
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tableXml)) !== null) {
    const cells = [];
    const cellPattern = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      cells.push(formatTableCellText(cellMatch[1], numberingState, numberingDefinitions));
    }

    if (cells.some(Boolean)) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) {
    return '';
  }

  const headerCells = rows[0].map((cell) => cell.replace(/\n/g, ' ').trim());
  const hasHeader = headerCells.some((cell) => /steps|modules|activities|users|erp/i.test(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((cells) => {
      if (!hasHeader) {
        return cells.filter(Boolean).join('\n');
      }

      return cells
        .map((cell, index) => {
          const header = headerCells[index] || `Column ${index + 1}`;

          if (!cell) {
            return '';
          }

          return `${header}:\n${cell}`;
        })
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function xmlToText(xml, numberingDefinitions = parseNumberingDefinitions()) {
  const blocks = [];
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  const bodyXml = bodyMatch ? bodyMatch[1] : xml;
  const blockPattern = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const numberingState = new Map();
  let match;

  while ((match = blockPattern.exec(bodyXml)) !== null) {
    const blockXml = match[0];

    if (blockXml.startsWith('<w:tbl')) {
      const tableText = formatTableText(blockXml, numberingDefinitions);

      if (tableText) {
        blocks.push(tableText);
      }

      continue;
    }

    const paragraphText = getParagraphsFromXml(blockXml, numberingState, numberingDefinitions).join('\n').trimEnd();

    if (paragraphText.trim()) {
      blocks.push(paragraphText);
    }
  }

  return stripWordLayoutArtifacts(blocks.join('\n\n'));
}

function findEndOfCentralDirectory(buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }

  return -1;
}

async function readZipEntry(buffer, entryName) {
  const endOfCentralDirectory = findEndOfCentralDirectory(buffer);

  if (endOfCentralDirectory < 0) {
    throw new Error('Invalid DOCX file.');
  }

  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  let offset = centralDirectoryOffset;

  while (offset < endOfCentralDirectory && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    if (fileName === entryName) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return compressedData;
      }

      if (compressionMethod === 8) {
        return inflateRaw(compressedData);
      }

      throw new Error('Unsupported DOCX compression method.');
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`DOCX entry was not found: ${entryName}`);
}

async function readOptionalZipEntry(buffer, entryName) {
  try {
    return await readZipEntry(buffer, entryName);
  } catch (error) {
    if (error.message.includes('DOCX entry was not found')) {
      return null;
    }

    throw error;
  }
}

async function extractDocxText(filePath) {
  const buffer = await fs.readFile(filePath);
  const documentXml = await readZipEntry(buffer, 'word/document.xml');
  const numberingXml = await readOptionalZipEntry(buffer, 'word/numbering.xml');
  const numberingDefinitions = parseNumberingDefinitions(numberingXml?.toString('utf8'));
  const content = xmlToText(documentXml.toString('utf8'), numberingDefinitions);

  return [
    {
      pageNumber: 1,
      content
    }
  ];
}

async function extractTxtText(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  return [
    {
      pageNumber: 1,
      content: content.trim()
    }
  ];
}

async function extractDocText(filePath) {
  const buffer = await fs.readFile(filePath);
  const textContent = decodePossiblyUtf16(buffer);

  if (looksLikeHtmlDocument(textContent)) {
    return htmlToTextPages(textContent);
  }

  const asciiText = buffer
    .toString('latin1')
    .match(/[A-Za-z0-9\s.,;:!?'"()[\]{}@#$%^&*_+=/\\|-]{5,}/g)
    ?.join(' ') || '';
  const utf16Text = buffer
    .toString('utf16le')
    .match(/[A-Za-z0-9\s.,;:!?'"()[\]{}@#$%^&*_+=/\\|-]{5,}/g)
    ?.join(' ') || '';
  const content = (utf16Text.length > asciiText.length ? utf16Text : asciiText)
    .replace(/\s{2,}/g, ' ')
    .trim();

  return [
    {
      pageNumber: 1,
      content
    }
  ];
}

async function extractDocumentText(filePath, originalName = filePath) {
  const extension = path.extname(originalName).toLowerCase();

  if (extension === '.pdf') {
    return extractTextByPage(filePath);
  }

  if (extension === '.docx') {
    return extractDocxText(filePath);
  }

  if (extension === '.txt') {
    return extractTxtText(filePath);
  }

  if (extension === '.doc') {
    return extractDocText(filePath);
  }

  throw new Error('Unsupported document type.');
}

module.exports = {
  extractDocumentText
};
