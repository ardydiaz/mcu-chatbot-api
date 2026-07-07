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

  const [existing] = await connection.query(
    'SELECT id FROM api_account WHERE email = ? LIMIT 1',
    ['api-account@mcu.local']
  );

  let apiAccountId = existing[0]?.id;

  if (!apiAccountId) {
    const [result] = await connection.query(
      `INSERT INTO api_account (name, email, password, role, approval_status)
       VALUES (?, ?, NULL, ?, ?)`,
      ['Default API Account', 'api-account@mcu.local', 'admin', 'approved']
    );
    apiAccountId = result.insertId;
  }

  const [updateResult] = await connection.query(
    'UPDATE documents SET uploaded_by = ?',
    [apiAccountId]
  );

  console.log(`Default API account id: ${apiAccountId}`);
  console.log(`Updated ${updateResult.affectedRows} document row(s).`);
  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
