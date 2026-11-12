const path = require('path');
const fs = require('fs/promises');
const pool = require('../utils/db');
const { processDocument, processImagesForDocument } = require('../services/pdfService');
const { toPublicPath } = require('../services/fileService');
const { ensureDocumentPreview } = require('../services/documentPreviewService');
const { normalizeScope } = require('../services/scopeService');
const { imageDir } = require('../config/env');

function cleanOptionalText(value, maxLength) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();

  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return value === true || value === 'true' || value === '1' || value === 1 || value === 'on';
}

async function getDefaultApiAccountId() {
  const [rows] = await pool.execute(
    'SELECT id FROM api_account WHERE email = ? LIMIT 1',
    ['api-account@mcu.local']
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await pool.execute(
    `INSERT INTO api_account (name, email, password, role, approval_status)
     VALUES (?, ?, NULL, ?, ?)`,
    ['Default API Account', 'api-account@mcu.local', 'admin', 'approved']
  );

  return result.insertId;
}

async function getDocumentUploaderIds(user) {
  const [userRows] = await pool.execute(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [user.email]
  );

  return {
    uploadedByApiAccountId: await getDefaultApiAccountId(),
    uploadedByUserId: userRows[0]?.id || null
  };
}

async function uploadDocument(req, res, next) {
  try {
    const uploadedFile = req.file || req.files?.pdf?.[0] || req.files?.file?.[0];

    if (!uploadedFile) {
      return res.status(400).json({ message: 'A PDF, Word, or text file is required.' });
    }

    const title = req.body.title || path.parse(uploadedFile.originalname).name;
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const topicCategory = cleanOptionalText(req.body.topicCategory || req.body.topic_category, 100);
    const suggestedPrompt = cleanOptionalText(req.body.suggestedPrompt || req.body.suggested_prompt, 255);
    const showAsTopic = parseBooleanFlag(req.body.showAsTopic || req.body.show_as_topic, true);
    const { uploadedByApiAccountId, uploadedByUserId } = await getDocumentUploaderIds(req.user);
    const document = await processDocument({
      title,
      filePath: uploadedFile.path,
      originalName: uploadedFile.originalname,
      uploadedBy: uploadedByApiAccountId,
      uploadedByUserId,
      siteScope,
      topicCategory,
      suggestedPrompt,
      showAsTopic
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
      `SELECT d.id, d.title, d.file_path, d.preview_file_path, d.created_at,
              COALESCE(login_user.name, api_user.name) AS uploaded_by,
              d.site_scope,
              d.topic_category,
              d.suggested_prompt,
              d.show_as_topic,
              COUNT(di.id) AS image_count
       FROM documents d
       LEFT JOIN users login_user ON login_user.id = d.uploaded_by_user_id
       LEFT JOIN api_account api_user ON api_user.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       GROUP BY d.id, d.title, d.file_path, d.preview_file_path, d.site_scope, d.topic_category, d.suggested_prompt, d.show_as_topic, d.created_at, login_user.name, api_user.name
       ORDER BY d.created_at DESC`
    );

    return res.json({ documents });
  } catch (error) {
    return next(error);
  }
}

async function listLibraryDocuments(req, res, next) {
  try {
    const [documents] = await pool.execute(
      `SELECT d.id, d.title, d.file_path, d.preview_file_path, d.created_at,
              COALESCE(login_user.name, api_user.name) AS uploaded_by,
              d.site_scope,
              d.suggested_prompt,
              COUNT(di.id) AS image_count
       FROM documents d
       LEFT JOIN users login_user ON login_user.id = d.uploaded_by_user_id
       LEFT JOIN api_account api_user ON api_user.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       -- Pages imported from mcu.edu.ph are searchable but stay out of the library list.
       WHERE d.source_url IS NULL
       GROUP BY d.id, d.title, d.file_path, d.preview_file_path, d.site_scope, d.suggested_prompt, d.created_at, login_user.name, api_user.name
       ORDER BY d.created_at DESC`
    );

    return res.json({
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        filePath: document.file_path,
        fileUrl: `/${toPublicPath(document.file_path)}`,
        previewFileUrl: document.preview_file_path ? `/${toPublicPath(document.preview_file_path)}` : null,
        siteScope: document.site_scope || 'general',
        suggestedPrompt: document.suggested_prompt,
        uploadedBy: document.uploaded_by || 'MCU Admin',
        createdAt: document.created_at,
        imageCount: Number(document.image_count || 0)
      }))
    });
  } catch (error) {
    return next(error);
  }
}

async function getLibraryDocumentPreview(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT id, title, file_path, preview_file_path
       FROM documents
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const document = rows[0];

    if (!document) {
      return res.status(404).json({ message: 'Document was not found.' });
    }

    if (document.preview_file_path) {
      return res.json({
        previewFileUrl: `/api/documents/${document.id}/preview-file`,
        originalFileUrl: `/${toPublicPath(document.file_path)}`,
        generated: false
      });
    }

    const preview = await ensureDocumentPreview({
      documentId: document.id,
      filePath: document.file_path
    });

    if (!preview.previewFilePath) {
      return res.status(422).json({
        message: 'This file type cannot be previewed in the browser.'
      });
    }

    if (preview.previewFilePath !== document.file_path) {
      await pool.execute(
        'UPDATE documents SET preview_file_path = ? WHERE id = ?',
        [preview.previewFilePath, document.id]
      );
    }

    return res.json({
      previewFileUrl: `/api/documents/${document.id}/preview-file`,
      originalFileUrl: `/${toPublicPath(document.file_path)}`,
      generated: preview.generated
    });
  } catch (error) {
    return next(error);
  }
}

async function getDocument(req, res, next) {
  try {
    const { id } = req.params;
    const [documentRows] = await pool.execute(
      `SELECT d.id, d.title, d.file_path, d.created_at,
              COALESCE(login_user.name, api_user.name) AS uploaded_by,
              d.site_scope,
              d.topic_category,
              d.suggested_prompt,
              d.show_as_topic,
              COUNT(di.id) AS image_count
       FROM documents d
       LEFT JOIN users login_user ON login_user.id = d.uploaded_by_user_id
       LEFT JOIN api_account api_user ON api_user.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       WHERE d.id = ?
       GROUP BY d.id, d.title, d.file_path, d.preview_file_path, d.site_scope, d.topic_category, d.suggested_prompt, d.show_as_topic, d.created_at, login_user.name, api_user.name
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
    let [images] = await pool.execute(
      `SELECT id, image_path, page_number
       FROM document_images
       WHERE document_id = ?
       ORDER BY page_number ASC, id ASC`,
      [id]
    );
    let imageCaptureError = '';
    const imagePreviewExtensions = new Set(['.pdf', '.doc', '.docx']);

    if (!images.length && imagePreviewExtensions.has(path.extname(document.file_path || '').toLowerCase())) {
      try {
        const captureResult = await processImagesForDocument({
          documentId: document.id,
          filePath: document.file_path,
          pageCount: Math.max(textPages.length, 1)
        });

        [images] = await pool.execute(
          `SELECT id, image_path, page_number
           FROM document_images
           WHERE document_id = ?
           ORDER BY page_number ASC, id ASC`,
          [id]
        );

        if (!images.length && captureResult.failedPages > 0) {
          imageCaptureError = `Captured document pages could not be generated: ${captureResult.failureMessage || 'page image conversion failed.'}`;
        }
      } catch (error) {
        imageCaptureError = `Captured document pages could not be generated: ${error.message}`;
        console.error(`Document ${document.id} page capture failed:`, error.message);
      }
    }

    let previewFilePath = document.preview_file_path || '';
    let previewError = '';

    if (!previewFilePath) {
      try {
        const preview = await ensureDocumentPreview({
          documentId: document.id,
          filePath: document.file_path
        });

        previewFilePath = preview.previewFilePath || '';

        if (previewFilePath && previewFilePath !== document.file_path) {
          await pool.execute(
            'UPDATE documents SET preview_file_path = ? WHERE id = ?',
            [previewFilePath, document.id]
          );
        }
      } catch (error) {
        previewError = error.message;
      }
    }

    return res.json({
      document: {
        id: document.id,
        title: document.title,
        filePath: document.file_path,
        fileUrl: `/${toPublicPath(document.file_path)}`,
        previewFileUrl: previewFilePath ? `/api/documents/${document.id}/preview-file` : '',
        previewError,
        siteScope: document.site_scope,
        topicCategory: document.topic_category,
        suggestedPrompt: document.suggested_prompt,
        showAsTopic: Boolean(document.show_as_topic),
        uploadedBy: document.uploaded_by,
        createdAt: document.created_at,
        imageCount: images.length || Number(document.image_count || 0),
        imageCaptureError,
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

async function saveCapturedDocumentPage(req, res, next) {
  try {
    const documentId = Number(req.params.id);
    const pageNumber = Number(req.body.pageNumber);

    if (!documentId || !pageNumber || pageNumber < 1) {
      return res.status(400).json({ message: 'Document ID and page number are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Captured page image is required.' });
    }

    if (!['image/png', 'image/jpeg'].includes(req.file.mimetype)) {
      return res.status(415).json({ message: 'Captured page must be a PNG or JPEG image.' });
    }

    const [documents] = await pool.execute(
      'SELECT id FROM documents WHERE id = ? LIMIT 1',
      [documentId]
    );

    if (!documents[0]) {
      return res.status(404).json({ message: 'Document was not found.' });
    }

    const extension = req.file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
    const documentImageDir = path.join(imageDir, String(documentId));
    const imagePath = path.join(documentImageDir, `page-${String(pageNumber).padStart(3, '0')}${extension}`);
    const relativeImagePath = path.relative(path.resolve(__dirname, '..', '..'), imagePath);

    await fs.mkdir(documentImageDir, { recursive: true });
    await fs.writeFile(imagePath, req.file.buffer);
    await pool.execute(
      'DELETE FROM document_images WHERE document_id = ? AND page_number = ?',
      [documentId, pageNumber]
    );
    const [result] = await pool.execute(
      `INSERT INTO document_images (document_id, image_path, page_number, ocr_text)
       VALUES (?, ?, ?, NULL)`,
      [documentId, relativeImagePath, pageNumber]
    );

    return res.status(201).json({
      image: {
        id: result.insertId,
        documentId,
        pageNumber,
        url: `/${toPublicPath(relativeImagePath)}`
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function streamDocumentPreview(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT id, file_path, preview_file_path
       FROM documents
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const document = rows[0];

    if (!document) {
      return res.status(404).send('Document was not found.');
    }

    let previewFilePath = document.preview_file_path || '';

    if (!previewFilePath) {
      const preview = await ensureDocumentPreview({
        documentId: document.id,
        filePath: document.file_path
      });

      previewFilePath = preview.previewFilePath || '';

      if (previewFilePath && previewFilePath !== document.file_path) {
        await pool.execute(
          'UPDATE documents SET preview_file_path = ? WHERE id = ?',
          [previewFilePath, document.id]
        );
      }
    }

    if (!previewFilePath) {
      return res.status(422).send('This file type cannot be previewed in the browser.');
    }

    const previewExtension = path.extname(previewFilePath).toLowerCase();

    await fs.access(previewFilePath);
    res.setHeader('Content-Type', previewExtension === '.txt' ? 'text/plain; charset=utf-8' : 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(path.resolve(previewFilePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).send('Preview file was not found on the server.');
    }

    return next(error);
  }
}

module.exports = {
  getDocument,
  getLibraryDocumentPreview,
  listLibraryDocuments,
  saveCapturedDocumentPage,
  streamDocumentPreview,
  uploadDocument,
  listDocuments
};
