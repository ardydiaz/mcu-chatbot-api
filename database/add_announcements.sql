USE mcu_chatbot;

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_scope VARCHAR(50) NOT NULL DEFAULT 'general',
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  priority ENUM('normal', 'important', 'urgent') NOT NULL DEFAULT 'normal',
  start_date DATE NULL,
  end_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_announcements_scope_active_dates (site_scope, is_active, start_date, end_date)
);
