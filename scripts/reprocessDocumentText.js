require('dotenv').config();

const mysql = require('mysql2/promise');
const { extractDocumentText } = require('../src/utils/documentParser');

async function main() {
  const documentId = Number(process.argv[2]);

  if (!documentId) {
    throw new Error('Usage: node scripts/reprocessDocumentText.js <documentId>');
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [documents] = await connection.query(
    'SELECT id, title, file_path FROM documents WHERE id = ? LIMIT 1',
    [documentId]
  );

  if (!documents[0]) {
    throw new Error(`Document ${documentId} was not found.`);
  }

  const document = documents[0];
  const pages = await extractDocumentText(document.file_path, document.file_path);

  await connection.beginTransaction();
  await connection.query('DELETE FROM document_text WHERE document_id = ?', [documentId]);

  for (const page of pages) {
    await connection.query(
      'INSERT INTO document_text (document_id, content, page_number) VALUES (?, ?, ?)',
      [documentId, page.content, page.pageNumber]
    );
  }

  await connection.commit();
  await connection.end();

  console.log(`Reprocessed document ${documentId}: ${document.title}`);
  console.log(`Pages saved: ${pages.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
