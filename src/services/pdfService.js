const pool = require('../utils/db');
const path = require('path');
const { extractDocumentText } = require('../utils/documentParser');
const { extractImages } = require('../utils/imageExtractor');
const { extractTextFromImage } = require('./ocrService');

function buildOcrSection(pageNumber, texts) {
  const content = texts.filter(Boolean).join('\n\n').trim();

  if (!content) {
    return '';
  }

  return `OCR extracted text from embedded images on page ${pageNumber}:\n${content}`;
}

async function processImagesForDocument({ documentId, filePath, pageCount }) {
  let savedImages = 0;
  const ocrTextsByPage = new Map();

  const extractionResult = await extractImages(filePath, documentId, pageCount, {
    async onImage(image) {
      const absoluteImagePath = path.resolve(__dirname, '..', '..', image.imagePath);
      const ocrText = await extractTextFromImage(absoluteImagePath);

      await pool.execute(
        `INSERT INTO document_images (document_id, image_path, page_number, ocr_text)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM document_images
           WHERE document_id = ? AND image_path = ?
         )`,
        [documentId, image.imagePath, image.pageNumber, ocrText || null, documentId, image.imagePath]
      );

      if (ocrText) {
        await pool.execute(
          `UPDATE document_images
           SET ocr_text = ?
           WHERE document_id = ? AND image_path = ?`,
          [ocrText, documentId, image.imagePath]
        );

        const pageTexts = ocrTextsByPage.get(image.pageNumber) || [];
        pageTexts.push(ocrText);
        ocrTextsByPage.set(image.pageNumber, pageTexts);
      }

      savedImages += 1;
    }
  });
  const { images, failedPages } = extractionResult;

  for (const [pageNumber, texts] of ocrTextsByPage.entries()) {
    const ocrSection = buildOcrSection(pageNumber, texts);

    if (!ocrSection) {
      continue;
    }

    await pool.execute(
      `UPDATE document_text
       SET content = CONCAT(content, '\n\n', ?)
       WHERE document_id = ? AND page_number = ?`,
      [ocrSection, documentId, pageNumber]
    );
  }

  return {
    images: savedImages || images.length,
    failedPages: failedPages.length,
    ocrImages: [...ocrTextsByPage.values()].reduce((total, texts) => total + texts.length, 0)
  };
}

async function processDocument({ title, filePath, originalName, uploadedBy, siteScope = 'general' }) {
  const connection = await pool.getConnection();
  let documentId;
  let pages = [];
  const extension = path.extname(originalName || filePath).toLowerCase();
  const supportsImageExtraction = ['.pdf', '.docx'].includes(extension);

  try {
    await connection.beginTransaction();

    const [documentResult] = await connection.execute(
      'INSERT INTO documents (title, file_path, site_scope, uploaded_by) VALUES (?, ?, ?, ?)',
      [title, filePath, siteScope, uploadedBy]
    );

    documentId = documentResult.insertId;
    pages = await extractDocumentText(filePath, originalName);

    for (const page of pages) {
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

  if (supportsImageExtraction) {
    setImmediate(() => {
      processImagesForDocument({
        documentId,
        filePath,
        pageCount: pages.length
      })
        .then((result) => {
          console.log(
            `Document ${documentId} image extraction complete: ${result.images} saved, ${result.ocrImages} OCR results, ${result.failedPages} failed.`
          );
        })
        .catch((error) => {
          console.error(`Document ${documentId} image extraction failed:`, error.message);
        });
    });
  }

  return {
    id: documentId,
    title,
    siteScope,
    type: extension.replace('.', '').toUpperCase(),
    pages: pages.length,
    images: 0,
    imagesProcessing: supportsImageExtraction,
    warning: supportsImageExtraction
      ? 'Document text was saved. Image extraction is running in the background.'
      : 'Document text was saved. Image extraction is only available for PDF and DOCX files.'
  };
}

module.exports = {
  processDocument,
  processImagesForDocument
};
