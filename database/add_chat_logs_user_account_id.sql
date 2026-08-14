ALTER TABLE chat_logs
  ADD COLUMN user_account_id INT NULL AFTER user_id,
  ADD INDEX idx_chat_logs_user_account_id (user_account_id),
  ADD CONSTRAINT fk_chat_logs_user_account
    FOREIGN KEY (user_account_id) REFERENCES users(id)
    ON DELETE SET NULL;
