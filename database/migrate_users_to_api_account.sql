USE mcu_chatbot;

CREATE TABLE IF NOT EXISTS api_account (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO api_account (id, name, email, password, role, created_at)
SELECT id, name, email, password, role, created_at
FROM users
WHERE NOT EXISTS (
  SELECT 1
  FROM api_account
  WHERE api_account.email = users.email
);

ALTER TABLE documents DROP FOREIGN KEY fk_documents_uploaded_by;
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES api_account(id)
  ON DELETE CASCADE;

ALTER TABLE chat_logs DROP FOREIGN KEY fk_chat_logs_user;
ALTER TABLE chat_logs
  ADD CONSTRAINT fk_chat_logs_user
  FOREIGN KEY (user_id) REFERENCES api_account(id)
  ON DELETE SET NULL;
