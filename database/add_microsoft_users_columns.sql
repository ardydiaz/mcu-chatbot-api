USE mcu_chatbot;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  microsoft_id VARCHAR(120) NULL UNIQUE,
  role ENUM('student', 'admin') NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SET @has_microsoft_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'microsoft_id'
);

SET @add_microsoft_id_sql := IF(
  @has_microsoft_id = 0,
  'ALTER TABLE users ADD COLUMN microsoft_id VARCHAR(120) NULL UNIQUE',
  'SELECT ''users.microsoft_id already exists'' AS message'
);

PREPARE add_microsoft_id_stmt FROM @add_microsoft_id_sql;
EXECUTE add_microsoft_id_stmt;
DEALLOCATE PREPARE add_microsoft_id_stmt;
