ALTER TABLE documents
  ADD COLUMN topic_category VARCHAR(100) NULL AFTER site_scope,
  ADD COLUMN suggested_prompt VARCHAR(255) NULL AFTER topic_category,
  ADD COLUMN show_as_topic TINYINT(1) NOT NULL DEFAULT 1 AFTER suggested_prompt;
