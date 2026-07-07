USE mcu_chatbot;

ALTER TABLE documents
  ADD COLUMN uploaded_by_user_id INT NULL AFTER uploaded_by;

ALTER TABLE documents
  ADD CONSTRAINT fk_documents_uploaded_by_user
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
  ON DELETE SET NULL;

UPDATE documents d
JOIN api_account a ON a.id = d.uploaded_by
JOIN users u ON u.email = a.email
SET d.uploaded_by_user_id = u.id
WHERE d.uploaded_by_user_id IS NULL;
