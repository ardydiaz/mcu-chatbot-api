const path = require('path');
const pool = require('../utils/db');
const { processDocument } = require('../services/pdfService');
const { toPublicPath } = require('../services/fileService');
const { normalizeScope } = require('../services/scopeService');

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

function normalizeAccessLevel(value) {
  return value === 'internal' ? 'internal' : 'external';
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
    const accessLevel = normalizeAccessLevel(req.body.accessLevel || req.body.access_level);
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
      accessLevel,
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
      `SELECT d.id, d.title, d.file_path, d.created_at,
              COALESCE(login_user.name, api_user.name) AS uploaded_by,
              d.site_scope,
              d.access_level,
              d.topic_category,
              d.suggested_prompt,
              d.show_as_topic,
              COUNT(di.id) AS image_count
       FROM documents d
       LEFT JOIN users login_user ON login_user.id = d.uploaded_by_user_id
       LEFT JOIN api_account api_user ON api_user.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       GROUP BY d.id, d.title, d.file_path, d.site_scope, d.access_level, d.topic_category, d.suggested_prompt, d.show_as_topic, d.created_at, login_user.name, api_user.name
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
      `SELECT d.id, d.title, d.file_path, d.created_at,
              COALESCE(login_user.name, api_user.name) AS uploaded_by,
              d.site_scope,
              d.access_level,
              d.topic_category,
              d.suggested_prompt,
              d.show_as_topic,
              COUNT(di.id) AS image_count
       FROM documents d
       LEFT JOIN users login_user ON login_user.id = d.uploaded_by_user_id
       LEFT JOIN api_account api_user ON api_user.id = d.uploaded_by
       LEFT JOIN document_images di ON di.document_id = d.id
       WHERE d.id = ?
       GROUP BY d.id, d.title, d.file_path, d.site_scope, d.access_level, d.topic_category, d.suggested_prompt, d.show_as_topic, d.created_at, login_user.name, api_user.name
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
        siteScope: document.site_scope,
        accessLevel: document.access_level || 'external',
        topicCategory: document.topic_category,
        suggestedPrompt: document.suggested_prompt,
        showAsTopic: Boolean(document.show_as_topic),
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
