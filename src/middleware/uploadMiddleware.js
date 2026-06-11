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

const uploadPdf = multer({
  storage,
  limits: {
    fileSize: uploadMaxFileSizeMb * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed.'));
    }

    return cb(null, true);
  }
});

module.exports = {
  uploadPdf
};
