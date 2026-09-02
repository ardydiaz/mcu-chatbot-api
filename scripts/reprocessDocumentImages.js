require('dotenv').config();

const pool = require('../src/utils/db');
const { processImagesForDocument } = require('../src/services/pdfService');

async function main() {
  const documentId = Number(process.argv[2]);

  if (!documentId) {
    throw new Error('Usage: npm run images:reprocess -- <documentId>');
  }

  const [documents] = await pool.execute(
    'SELECT id, title, file_path FROM documents WHERE id = ? LIMIT 1',
    [documentId]
  );

  if (!documents[0]) {
    throw new Error(`Document ${documentId} was not found.`);
  }

  const [pageRows] = await pool.execute(
    'SELECT COUNT(*) AS page_count FROM document_text WHERE document_id = ?',
    [documentId]
  );

  await pool.execute('DELETE FROM document_images WHERE document_id = ?', [documentId]);

  const result = await processImagesForDocument({
    documentId,
    filePath: documents[0].file_path,
    pageCount: Number(pageRows[0]?.page_count || 1)
  });

  console.log(`Reprocessed images for document ${documentId}: ${documents[0].title}`);
  console.log(`${result.images} images saved, ${result.ocrImages} OCR results, ${result.failedPages} failed pages.`);

  if (result.failureMessage) {
    console.log(`First capture error: ${result.failureMessage}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
