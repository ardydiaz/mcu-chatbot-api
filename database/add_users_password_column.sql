USE mcu_chatbot;

SET @has_password := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password'
);

SET @add_password_sql := IF(
  @has_password = 0,
  'ALTER TABLE users ADD COLUMN password VARCHAR(255) NULL AFTER email',
  'SELECT ''users.password already exists'' AS message'
);

PREPARE add_password_stmt FROM @add_password_sql;
EXECUTE add_password_stmt;
DEALLOCATE PREPARE add_password_stmt;

ALTER TABLE users
  MODIFY password VARCHAR(255) NULL;
