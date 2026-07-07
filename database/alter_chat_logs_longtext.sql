USE mcu_chatbot;

ALTER TABLE chat_logs
  MODIFY message LONGTEXT NOT NULL,
  MODIFY response LONGTEXT NOT NULL;
