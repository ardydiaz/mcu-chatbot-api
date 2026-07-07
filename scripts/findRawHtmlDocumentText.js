require('dotenv').config();

const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [rows] = await connection.query(`
    SELECT
      dt.id AS text_id,
      dt.document_id,
      dt.page_number,
      d.title,
      d.file_path,
      LEFT(dt.content, 220) AS preview
    FROM document_text dt
    JOIN documents d ON d.id = dt.document_id
    WHERE dt.content LIKE '%xmlns%'
       OR dt.content LIKE '%Microsoft Word%'
       OR dt.content LIKE '%filelist.xml%'
       OR dt.content LIKE '%schemas-microsoft%'
       OR dt.content LIKE '%mso %'
    ORDER BY dt.id
  `);

  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
