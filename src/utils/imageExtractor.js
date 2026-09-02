const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { fromPath } = require('pdf2pic');
const { imageDir, pdf2picGmClass } = require('../config/env');

const inflateRaw = promisify(zlib.inflateRaw);

async function convertWithPdf2pic(filePath, documentImageDir, pageNumber) {
  const converter = fromPath(filePath, {
    density: 100,
    saveFilename: `page-${pageNumber}`,
    savePath: documentImageDir,
    format: 'png',
    width: 1000,
    height: 1400
  });

  if (pdf2picGmClass) {
    converter.setGMClass(pdf2picGmClass === 'true' ? true : pdf2picGmClass);
  }

  const page = await converter(pageNumber, { responseType: 'image' });
  return page.path;
}

async function extractImages(filePath, documentId, pageCount, options = {}) {
  if (path.extname(filePath).toLowerCase() === '.docx') {
    return extractDocxImages(filePath, documentId, options);
  }

  const documentImageDir = path.join(imageDir, String(documentId));
  await fs.mkdir(documentImageDir, { recursive: true });

  const images = [];
  const failedPages = [];
  const onImage = options.onImage;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      const imagePath = await convertWithPdf2pic(filePath, documentImageDir, pageNumber);

      images.push({
        pageNumber,
        imagePath: path.relative(path.resolve(__dirname, '..', '..'), imagePath)
      });

      if (onImage) {
        await onImage(images[images.length - 1]);
      }
    } catch (error) {
      failedPages.push({
        pageNumber,
        message: error.message || 'Image conversion failed.'
      });
    }
  }

  return {
    images,
    failedPages
  };
}

function findEndOfCentralDirectory(buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }

  return -1;
}

function listZipEntries(buffer) {
  const endOfCentralDirectory = findEndOfCentralDirectory(buffer);

  if (endOfCentralDirectory < 0) {
    throw new Error('Invalid DOCX file.');
  }

  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  let offset = centralDirectoryOffset;
  const entries = [];

  while (offset < endOfCentralDirectory && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    entries.push({
      compressionMethod,
      compressedSize,
      fileName,
      localHeaderOffset
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntryData(buffer, entry) {
  const localFileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraLength;
  const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedData;
  }

  if (entry.compressionMethod === 8) {
    return inflateRaw(compressedData);
  }

  throw new Error('Unsupported DOCX compression method.');
}

function getMediaExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

  return allowedExtensions.has(extension) ? extension : '.png';
}

async function extractDocxImages(filePath, documentId, options = {}) {
  const documentImageDir = path.join(imageDir, String(documentId));
  await fs.mkdir(documentImageDir, { recursive: true });

  const buffer = await fs.readFile(filePath);
  const mediaEntries = listZipEntries(buffer)
    .filter((entry) => /^word\/media\/.+/i.test(entry.fileName));
  const images = [];
  const failedPages = [];

  for (let index = 0; index < mediaEntries.length; index += 1) {
    const entry = mediaEntries[index];
    const pageNumber = 1;

    try {
      const imageData = await readZipEntryData(buffer, entry);
      const imagePath = path.join(
        documentImageDir,
        `docx-image-${String(index + 1).padStart(3, '0')}${getMediaExtension(entry.fileName)}`
      );

      await fs.writeFile(imagePath, imageData);
      images.push({
        pageNumber,
        imagePath: path.relative(path.resolve(__dirname, '..', '..'), imagePath)
      });

      if (options.onImage) {
        await options.onImage(images[images.length - 1]);
      }
    } catch (error) {
      failedPages.push({
        pageNumber,
        message: error.message || 'DOCX image extraction failed.'
      });
    }
  }

  return {
    images,
    failedPages
  };
}

module.exports = {
  extractImages
};
