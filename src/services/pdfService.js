const pool = require('../utils/db');
const { extractTextByPage } = require('../utils/pdfParser');
const { extractImages } = require('../utils/imageExtractor');

async function processPdf({ title, filePath, uploadedBy }) {
  const connection = await pool.getConnection();
  let documentId;
  let pages = [];

  try {
    await connection.beginTransaction();

    const [documentResult] = await connection.execute(
      'INSERT INTO documents (title, file_path, uploaded_by) VALUES (?, ?, ?)',
      [title, filePath, uploadedBy]
    );

    documentId = documentResult.insertId;
    pages = await extractTextByPage(filePath);

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

  let images = [];
  let failedPages = [];
  let imageExtractionError = null;

  try {
    const extractionResult = await extractImages(filePath, documentId, pages.length);
    images = extractionResult.images;
    failedPages = extractionResult.failedPages;

    for (const image of images) {
      await pool.execute(
        'INSERT INTO document_images (document_id, image_path, page_number) VALUES (?, ?, ?)',
        [documentId, image.imagePath, image.pageNumber]
      );
    }
  } catch (error) {
    imageExtractionError = error.message || 'PDF image extraction failed.';
  }

  const failedPageWarning = failedPages.length > 0
    ? `${failedPages.length} page image(s) failed to convert. ${failedPages
      .slice(0, 3)
      .map((page) => `Page ${page.pageNumber}: ${page.message}`)
      .join(' ')}`
    : null;

  return {
    id: documentId,
    title,
    pages: pages.length,
    images: images.length,
    warning: imageExtractionError || failedPageWarning
      ? `PDF text was saved. ${imageExtractionError || failedPageWarning}`
      : null
  };
}

module.exports = {
  processPdf
};
