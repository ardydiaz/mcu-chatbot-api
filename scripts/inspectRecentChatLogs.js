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
      id,
      LEFT(message, 160) AS message,
      LEFT(response, 260) AS response,
      created_at
    FROM chat_logs
    ORDER BY id DESC
    LIMIT 10
  `);

  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
