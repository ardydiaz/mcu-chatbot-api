USE mcu_chatbot;

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
WHERE u.id IS NULL;
