USE mcu_chatbot;

ALTER TABLE documents
  ADD COLUMN access_level ENUM('external', 'internal') NOT NULL DEFAULT 'external' AFTER site_scope;
