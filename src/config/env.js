const path = require('path');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..', '..');

module.exports = {
  port: process.env.PORT || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:8080',
  jwtSecret: process.env.JWT_SECRET || 'change_this_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
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
