const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { db } = require('../src/config/env');

const databaseDir = path.resolve(__dirname, '..', 'database');
const migrationOrder = [
  'add_users_approval_columns.sql',
  'add_users_password_column.sql',
  'add_account_approval_columns.sql',
  'add_document_uploaded_by_user.sql',
  'add_microsoft_users_columns.sql',
  'alter_chat_logs_longtext.sql',
  'add_embed_tokens.sql',
  'add_document_topic_metadata.sql'
];

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(databaseDir, fileName), 'utf8');
}

function isAlreadyAppliedError(error) {
  return [
    'ER_DUP_FIELDNAME',
    'ER_DUP_KEYNAME',
    'ER_FK_DUP_NAME',
    'ER_TABLE_EXISTS_ERROR'
  ].includes(error.code) || [1060, 1061, 1050, 1826].includes(error.errno);
}

async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    multipleStatements: true
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function runSqlFile(connection, fileName) {
  const statements = splitSqlStatements(readSqlFile(fileName));

  for (const statement of statements) {
    try {
      await connection.query(statement);
    } catch (error) {
      if (isAlreadyAppliedError(error)) {
        console.log(`Already applied in ${fileName}: ${error.message}`);
        continue;
      }

      throw error;
    }
  }
}

async function createMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(connection) {
  const [rows] = await connection.query('SELECT migration FROM schema_migrations');

  return new Set(rows.map((row) => row.migration));
}

async function markMigrationApplied(connection, fileName) {
  await connection.query(
    'INSERT IGNORE INTO schema_migrations (migration) VALUES (?)',
    [fileName]
  );
}

async function migrate() {
  await ensureDatabaseExists();

  const connection = await mysql.createConnection({
    ...db,
    multipleStatements: true
  });

  try {
    console.log(`Using database: ${db.database}`);
    await runSqlFile(connection, 'schema.sql');
    await createMigrationTable(connection);

    const appliedMigrations = await getAppliedMigrations(connection);

    for (const fileName of migrationOrder) {
      if (appliedMigrations.has(fileName)) {
        console.log(`Skipped ${fileName}`);
        continue;
      }

      console.log(`Running ${fileName}`);
      await runSqlFile(connection, fileName);
      await markMigrationApplied(connection, fileName);
      console.log(`Applied ${fileName}`);
    }

    console.log('Database migration complete.');
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
