ALTER TABLE documents
  ADD COLUMN preview_file_path VARCHAR(500) NULL AFTER file_path;
