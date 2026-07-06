const pool = require('../utils/db');
const { generateEmbedToken, normalizeOrigin } = require('../services/embedSecurityService');
const { normalizeScope } = require('../services/scopeService');

function mapOrigin(row) {
  return {
    id: row.id,
    siteScope: row.site_scope,
    origin: row.origin,
    label: row.label || '',
    embedToken: row.embed_token || '',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listEmbedOrigins(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, site_scope, origin, label, embed_token, is_active, created_at, updated_at
       FROM embed_allowed_origins
       ORDER BY site_scope ASC, origin ASC`
    );

    return res.json({ origins: rows.map(mapOrigin) });
  } catch (error) {
    return next(error);
  }
}

async function createEmbedOrigin(req, res, next) {
  try {
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const origin = normalizeOrigin(req.body.origin);
    const label = String(req.body.label || '').trim() || null;
    const embedToken = generateEmbedToken();

    if (!origin) {
      return res.status(400).json({ message: 'Valid website origin is required.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO embed_allowed_origins (site_scope, origin, label, embed_token, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [siteScope, origin, label, embedToken]
    );

    const [rows] = await pool.execute(
      `SELECT id, site_scope, origin, label, embed_token, is_active, created_at, updated_at
       FROM embed_allowed_origins
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ origin: mapOrigin(rows[0]) });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This website is already allowed for the selected scope.' });
    }

    return next(error);
  }
}

async function updateEmbedOrigin(req, res, next) {
  try {
    const id = Number(req.params.id);
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const origin = normalizeOrigin(req.body.origin);
    const label = String(req.body.label || '').trim() || null;
    const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive);

    if (!origin) {
      return res.status(400).json({ message: 'Valid website origin is required.' });
    }

    const [result] = await pool.execute(
      `UPDATE embed_allowed_origins
       SET site_scope = ?, origin = ?, label = ?, is_active = ?
       WHERE id = ?`,
      [siteScope, origin, label, isActive ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Website access record was not found.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, site_scope, origin, label, embed_token, is_active, created_at, updated_at
       FROM embed_allowed_origins
       WHERE id = ?`,
      [id]
    );

    return res.json({ origin: mapOrigin(rows[0]) });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This website is already allowed for the selected scope.' });
    }

    return next(error);
  }
}

async function regenerateEmbedToken(req, res, next) {
  try {
    const id = Number(req.params.id);
    const embedToken = generateEmbedToken();
    const [result] = await pool.execute(
      `UPDATE embed_allowed_origins
       SET embed_token = ?
       WHERE id = ?`,
      [embedToken, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Website access record was not found.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, site_scope, origin, label, embed_token, is_active, created_at, updated_at
       FROM embed_allowed_origins
       WHERE id = ?`,
      [id]
    );

    return res.json({ origin: mapOrigin(rows[0]) });
  } catch (error) {
    return next(error);
  }
}

async function deleteEmbedOrigin(req, res, next) {
  try {
    const [result] = await pool.execute(
      'DELETE FROM embed_allowed_origins WHERE id = ?',
      [Number(req.params.id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Website access record was not found.' });
    }

    return res.json({ message: 'Website access record deleted.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createEmbedOrigin,
  deleteEmbedOrigin,
  listEmbedOrigins,
  regenerateEmbedToken,
  updateEmbedOrigin
};
