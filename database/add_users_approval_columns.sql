USE mcu_chatbot;

SET @has_approval_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'approval_status'
);

SET @add_approval_status_sql := IF(
  @has_approval_status = 0,
  'ALTER TABLE users ADD COLUMN approval_status ENUM(''pending'', ''approved'', ''rejected'') NOT NULL DEFAULT ''pending'' AFTER role',
  'SELECT ''users.approval_status already exists'' AS message'
);

PREPARE add_approval_status_stmt FROM @add_approval_status_sql;
EXECUTE add_approval_status_stmt;
DEALLOCATE PREPARE add_approval_status_stmt;

SET @has_approved_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'approved_at'
);

SET @add_approved_at_sql := IF(
  @has_approved_at = 0,
  'ALTER TABLE users ADD COLUMN approved_at TIMESTAMP NULL AFTER approval_status',
  'SELECT ''users.approved_at already exists'' AS message'
);

PREPARE add_approved_at_stmt FROM @add_approved_at_sql;
EXECUTE add_approved_at_stmt;
DEALLOCATE PREPARE add_approved_at_stmt;

SET @has_approved_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'approved_by'
);

SET @add_approved_by_sql := IF(
  @has_approved_by = 0,
  'ALTER TABLE users ADD COLUMN approved_by INT NULL AFTER approved_at',
  'SELECT ''users.approved_by already exists'' AS message'
);

PREPARE add_approved_by_stmt FROM @add_approved_by_sql;
EXECUTE add_approved_by_stmt;
DEALLOCATE PREPARE add_approved_by_stmt;
