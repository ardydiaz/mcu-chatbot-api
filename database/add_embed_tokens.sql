USE mcu_chatbot;

ALTER TABLE embed_allowed_origins
  ADD COLUMN embed_token VARCHAR(120) NULL AFTER label;
