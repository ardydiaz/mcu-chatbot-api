const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { extractTextByPage } = require('./pdfParser');

const inflateRaw = promisify(zlib.inflateRaw);

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlToText(xml) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
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

async function extractDocxText(filePath) {
  const buffer = await fs.readFile(filePath);
  const documentXml = await readZipEntry(buffer, 'word/document.xml');
  const content = xmlToText(documentXml.toString('utf8'));

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
