USE mcu_chatbot;

ALTER TABLE api_account
  MODIFY password VARCHAR(255) NULL;

SET @has_microsoft_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'api_account'
    AND COLUMN_NAME = 'microsoft_id'
);

SET @add_microsoft_id_sql := IF(
  @has_microsoft_id = 0,
  'ALTER TABLE api_account ADD COLUMN microsoft_id VARCHAR(120) NULL UNIQUE AFTER password',
  'SELECT ''api_account.microsoft_id already exists'' AS message'
);

PREPARE add_microsoft_id_stmt FROM @add_microsoft_id_sql;
EXECUTE add_microsoft_id_stmt;
DEALLOCATE PREPARE add_microsoft_id_stmt;

SET @has_approval_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'api_account'
    AND COLUMN_NAME = 'approval_status'
);

SET @add_approval_status_sql := IF(
  @has_approval_status = 0,
  'ALTER TABLE api_account ADD COLUMN approval_status ENUM(''pending'', ''approved'', ''rejected'') NOT NULL DEFAULT ''pending'' AFTER role',
  'SELECT ''api_account.approval_status already exists'' AS message'
);

PREPARE add_approval_status_stmt FROM @add_approval_status_sql;
EXECUTE add_approval_status_stmt;
DEALLOCATE PREPARE add_approval_status_stmt;

SET @has_approved_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'api_account'
    AND COLUMN_NAME = 'approved_at'
);

SET @add_approved_at_sql := IF(
  @has_approved_at = 0,
  'ALTER TABLE api_account ADD COLUMN approved_at TIMESTAMP NULL AFTER approval_status',
  'SELECT ''api_account.approved_at already exists'' AS message'
);

PREPARE add_approved_at_stmt FROM @add_approved_at_sql;
EXECUTE add_approved_at_stmt;
DEALLOCATE PREPARE add_approved_at_stmt;

SET @has_approved_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'api_account'
    AND COLUMN_NAME = 'approved_by'
);

SET @add_approved_by_sql := IF(
  @has_approved_by = 0,
  'ALTER TABLE api_account ADD COLUMN approved_by INT NULL AFTER approved_at',
  'SELECT ''api_account.approved_by already exists'' AS message'
);

PREPARE add_approved_by_stmt FROM @add_approved_by_sql;
EXECUTE add_approved_by_stmt;
DEALLOCATE PREPARE add_approved_by_stmt;

UPDATE api_account
SET approval_status = 'approved',
    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
    approved_by = COALESCE(approved_by, id)
WHERE email = 'adminmcu@mcu.edu.ph';
