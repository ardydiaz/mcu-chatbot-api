CREATE DATABASE IF NOT EXISTS mcu_chatbot;
USE mcu_chatbot;

CREATE TABLE IF NOT EXISTS api_account (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(255) NULL,
  microsoft_id VARCHAR(120) NULL UNIQUE,
  role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMP NULL,
  approved_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(255) NULL,
  microsoft_id VARCHAR(120) NULL UNIQUE,
  role ENUM('student', 'admin') NOT NULL DEFAULT 'admin',
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMP NULL,
  approved_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  uploaded_by INT NOT NULL,
  uploaded_by_user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES api_account(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_documents_uploaded_by_user
    FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS document_text (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  content LONGTEXT NOT NULL,
  page_number INT NOT NULL,
  FULLTEXT KEY ft_document_text_content (content),
  CONSTRAINT fk_document_text_document
    FOREIGN KEY (document_id) REFERENCES documents(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  page_number INT NOT NULL,
  ocr_text TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_images_document
    FOREIGN KEY (document_id) REFERENCES documents(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  message LONGTEXT NOT NULL,
  response LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_logs_user
    FOREIGN KEY (user_id) REFERENCES api_account(id)
    ON DELETE SET NULL
);
