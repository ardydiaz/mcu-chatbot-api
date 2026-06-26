const path = require('path');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..', '..');

module.exports = {
  port: process.env.PORT || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'change_this_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  ollamaEnabled: process.env.OLLAMA_ENABLED !== 'false',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:8b',
  ollamaRequestTimeoutMs: Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS || 30000),
  ocrEnabled: process.env.OCR_ENABLED !== 'false',
  ocrCommand: process.env.OCR_COMMAND || 'tesseract',
  ocrLanguage: process.env.OCR_LANGUAGE || 'eng',
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || '',
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || '',
  microsoftAllowedDomain: process.env.MICROSOFT_ALLOWED_DOMAIN || '',
  microsoftAdminEmails: (process.env.MICROSOFT_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'storage/uploads'),
  imageDir: path.resolve(rootDir, process.env.IMAGE_DIR || 'storage/images'),
  uploadMaxFileSizeMb: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 100),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mcu_chatbot'
  }
};
