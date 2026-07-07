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

  const [result] = await connection.query(`
    INSERT INTO users (name, email, password, microsoft_id, role, approval_status, approved_at, approved_by, created_at)
    SELECT
      a.name,
      LOWER(a.email),
      a.password,
      a.microsoft_id,
      a.role,
      COALESCE(a.approval_status, 'approved'),
      a.approved_at,
      a.approved_by,
      a.created_at
    FROM api_account a
    LEFT JOIN users u ON u.email = a.email
    WHERE u.id IS NULL
  `);

  console.log(`Migrated ${result.affectedRows} api_account row(s) to users.`);
  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
