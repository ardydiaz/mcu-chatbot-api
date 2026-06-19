const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { uploadDir, uploadMaxFileSizeMb } = require('../config/env');

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.txt']);
const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
]);

const uploadDocumentFile = multer({
  storage,
  limits: {
    fileSize: uploadMaxFileSizeMb * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(extension) && !allowedMimeTypes.has(file.mimetype)) {
      const error = new Error('Only PDF, Word, and text files are allowed.');
      error.status = 400;
      return cb(error);
    }

    return cb(null, true);
  }
});

module.exports = {
  uploadDocumentFile
};
