ALTER TABLE documents
  ADD COLUMN source_url VARCHAR(500) NULL AFTER preview_file_path;

ALTER TABLE documents
  ADD UNIQUE KEY uq_documents_source_url (source_url);
