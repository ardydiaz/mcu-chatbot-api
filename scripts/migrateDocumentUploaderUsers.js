require('dotenv').config();

const mysql = require('mysql2/promise');

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function constraintExists(connection, constraintName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'documents'
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [constraintName]
  );

  return rows.length > 0;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  if (!await columnExists(connection, 'documents', 'uploaded_by_user_id')) {
    await connection.query('ALTER TABLE documents ADD COLUMN uploaded_by_user_id INT NULL AFTER uploaded_by');
    console.log('Added documents.uploaded_by_user_id.');
  } else {
    console.log('documents.uploaded_by_user_id already exists.');
  }

  if (!await constraintExists(connection, 'fk_documents_uploaded_by_user')) {
    await connection.query(
      `ALTER TABLE documents
       ADD CONSTRAINT fk_documents_uploaded_by_user
       FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
       ON DELETE SET NULL`
    );
    console.log('Added fk_documents_uploaded_by_user.');
  } else {
    console.log('fk_documents_uploaded_by_user already exists.');
  }

  const [result] = await connection.query(
    `UPDATE documents d
     JOIN api_account a ON a.id = d.uploaded_by
     JOIN users u ON u.email = a.email
     SET d.uploaded_by_user_id = u.id
     WHERE d.uploaded_by_user_id IS NULL`
  );

  console.log(`Mapped ${result.affectedRows} existing document uploader row(s).`);
  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
