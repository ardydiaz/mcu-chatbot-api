const pool = require('../utils/db');
const path = require('path');
const { extractDocumentText } = require('../utils/documentParser');
const { extractImages } = require('../utils/imageExtractor');

async function processImagesForDocument({ documentId, filePath, pageCount }) {
  let savedImages = 0;
  const extractionResult = await extractImages(filePath, documentId, pageCount, {
    async onImage(image) {
      await pool.execute(
        `INSERT INTO document_images (document_id, image_path, page_number)
         SELECT ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM document_images
           WHERE document_id = ? AND page_number = ?
         )`,
        [documentId, image.imagePath, image.pageNumber, documentId, image.pageNumber]
      );
      savedImages += 1;
    }
  });
  const { images, failedPages } = extractionResult;

  return {
    images: savedImages || images.length,
    failedPages: failedPages.length
  };
}

async function processDocument({ title, filePath, originalName, uploadedBy }) {
  const connection = await pool.getConnection();
  let documentId;
  let pages = [];
  const extension = path.extname(originalName || filePath).toLowerCase();
  const isPdf = extension === '.pdf';

  try {
    await connection.beginTransaction();

    const [documentResult] = await connection.execute(
      'INSERT INTO documents (title, file_path, uploaded_by) VALUES (?, ?, ?)',
      [title, filePath, uploadedBy]
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

  if (isPdf) {
    setImmediate(() => {
      processImagesForDocument({
        documentId,
        filePath,
        pageCount: pages.length
      })
        .then((result) => {
          console.log(
            `Document ${documentId} image extraction complete: ${result.images} saved, ${result.failedPages} failed.`
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
    type: extension.replace('.', '').toUpperCase(),
    pages: pages.length,
    images: 0,
    imagesProcessing: isPdf,
    warning: isPdf
      ? 'PDF text was saved. Image extraction is running in the background.'
      : 'Document text was saved. Image extraction is only available for PDF files.'
  };
}

module.exports = {
  processDocument,
  processImagesForDocument
};
