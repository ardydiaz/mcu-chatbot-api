const path = require('path');
const pool = require('../utils/db');
const { processDocument } = require('../services/pdfService');
const { toPublicPath } = require('../services/fileService');

async function getDocumentUploaderId(user) {
  const [rows] = await pool.execute(
    'SELECT id FROM api_account WHERE email = ? LIMIT 1',
    [user.email]
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await pool.execute(
    `INSERT INTO api_account (name, email, password, role, approval_status)
     VALUES (?, ?, NULL, ?, ?)`,
    [user.name || user.email, user.email, user.role || 'admin', 'approved']
  );

  return result.insertId;
}

async function uploadDocument(req, res, next) {
  try {
    const uploadedFile = req.file || req.files?.pdf?.[0] || req.files?.file?.[0];

    if (!uploadedFile) {
      return res.status(400).json({ message: 'A PDF, Word, or text file is required.' });
    }

    const title = req.body.title || path.parse(uploadedFile.originalname).name;
    const uploadedBy = await getDocumentUploaderId(req.user);
    const document = await processDocument({
      title,
      filePath: uploadedFile.path,
      originalName: uploadedFile.originalname,
      uploadedBy
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

async function getDocument(req, res, next) {
  try {
    const { id } = req.params;
    const [documentRows] = await pool.execute(
      `SELECT d.id, d.title, d.file_path, d.created_at, u.name AS uploaded_by,
              COUNT(di.id) AS image_count
       FROM documents d
       JOIN api_account u ON u.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       WHERE d.id = ?
       GROUP BY d.id, d.title, d.file_path, d.created_at, u.name
       LIMIT 1`,
      [id]
    );
    const document = documentRows[0];

    if (!document) {
      return res.status(404).json({ message: 'Document was not found.' });
    }

    const [textPages] = await pool.execute(
      `SELECT page_number, content
       FROM document_text
       WHERE document_id = ?
       ORDER BY page_number ASC`,
      [id]
    );
    const [images] = await pool.execute(
      `SELECT id, image_path, page_number
       FROM document_images
       WHERE document_id = ?
       ORDER BY page_number ASC, id ASC`,
      [id]
    );

    return res.json({
      document: {
        id: document.id,
        title: document.title,
        filePath: document.file_path,
        fileUrl: `/${toPublicPath(document.file_path)}`,
        uploadedBy: document.uploaded_by,
        createdAt: document.created_at,
        imageCount: Number(document.image_count || 0),
        textPages: textPages.map((page) => ({
          pageNumber: page.page_number,
          content: page.content
        })),
        images: images.map((image) => ({
          id: image.id,
          pageNumber: image.page_number,
          url: `/${toPublicPath(image.image_path)}`
        }))
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getDocument,
  uploadDocument,
  listDocuments
};
