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

  await connection.query(
    'ALTER TABLE chat_logs MODIFY message LONGTEXT NOT NULL, MODIFY response LONGTEXT NOT NULL'
  );

  const [columns] = await connection.query(
    "SHOW COLUMNS FROM chat_logs WHERE Field IN ('message', 'response')"
  );

  for (const column of columns) {
    console.log(`${column.Field}: ${column.Type}`);
  }

  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
