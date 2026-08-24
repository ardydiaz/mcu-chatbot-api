const pool = require('../src/utils/db');
const { deleteDocumentVectors, indexDocumentPages, isQdrantEnabled } = require('../src/services/qdrantService');

async function main() {
  if (!isQdrantEnabled()) {
    console.log('Qdrant is disabled. Set QDRANT_ENABLED=true before running this script.');
    return;
  }

  const [documents] = await pool.execute(
    `SELECT id, title, site_scope, access_level
     FROM documents
     ORDER BY id ASC`
  );

  let totalChunks = 0;

  for (const document of documents) {
    const [pages] = await pool.execute(
      `SELECT page_number AS pageNumber, content
       FROM document_text
       WHERE document_id = ?
       ORDER BY page_number ASC`,
      [document.id]
    );

    await deleteDocumentVectors(document.id);
    const result = await indexDocumentPages({
      documentId: document.id,
      title: document.title,
      siteScope: document.site_scope || 'general',
      accessLevel: document.access_level || 'external',
      pages
    });

    totalChunks += result.indexed || 0;
    console.log(`Indexed document ${document.id} (${document.title}): ${result.indexed || 0} chunks`);
  }

  console.log(`Qdrant reindex complete. ${totalChunks} chunks indexed from ${documents.length} documents.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
