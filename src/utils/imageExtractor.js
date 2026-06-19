const fs = require('fs/promises');
const path = require('path');
const pdfPoppler = require('pdf-poppler');
const { fromPath } = require('pdf2pic');
const { imageDir } = require('../config/env');

function getPopplerImagePath(documentImageDir, pageNumber) {
  return path.join(documentImageDir, `page-${String(pageNumber).padStart(3, '0')}.png`);
}

async function convertWithPoppler(filePath, documentImageDir, pageNumber) {
  await pdfPoppler.convert(filePath, {
    format: 'png',
    out_dir: documentImageDir,
    out_prefix: 'page',
    page: pageNumber,
    scale: 1400
  });

  return getPopplerImagePath(documentImageDir, pageNumber);
}

async function convertWithPdf2pic(filePath, documentImageDir, pageNumber) {
  const converter = fromPath(filePath, {
    density: 100,
    saveFilename: `page-${pageNumber}`,
    savePath: documentImageDir,
    format: 'png',
    width: 1000,
    height: 1400
  });

  const page = await converter(pageNumber, { responseType: 'image' });
  return page.path;
}

async function extractImages(filePath, documentId, pageCount, options = {}) {
  const documentImageDir = path.join(imageDir, String(documentId));
  await fs.mkdir(documentImageDir, { recursive: true });

  const images = [];
  const failedPages = [];
  const onImage = options.onImage;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      let imagePath;

      try {
        imagePath = await convertWithPoppler(filePath, documentImageDir, pageNumber);
      } catch (popplerError) {
        imagePath = await convertWithPdf2pic(filePath, documentImageDir, pageNumber);
      }

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

module.exports = {
  extractImages
};
