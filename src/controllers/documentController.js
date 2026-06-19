const path = require('path');
const pool = require('../utils/db');
const { processPdf } = require('../services/pdfService');

async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required.' });
    }

    const title = req.body.title || path.parse(req.file.originalname).name;
    const document = await processPdf({
      title,
      filePath: req.file.path,
      uploadedBy: req.user.id
    });

    return res.status(201).json({
      message: 'Document uploaded and processed.',
      document
    });
  } catch (error) {
    return next(error);
  }
}

async function listDocuments(req, res, next) {
  try {
    const [documents] = await pool.execute(
      `SELECT d.id, d.title, d.file_path, d.created_at, u.name AS uploaded_by,
              COUNT(di.id) AS image_count
       FROM documents d
       JOIN api_account u ON u.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       GROUP BY d.id, d.title, d.file_path, d.created_at, u.name
       ORDER BY d.created_at DESC`
    );

    return res.json({ documents });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  uploadDocument,
  listDocuments
};
