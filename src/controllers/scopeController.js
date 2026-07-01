const pool = require('../utils/db');
const { listScopes, normalizeScopeKey } = require('../services/scopeService');

function mapScope(row) {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    label: row.label,
    description: row.description || '',
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 100),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listChatbotScopes(req, res, next) {
  try {
    const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
    const scopes = await listScopes({ activeOnly });

    return res.json({ scopes });
  } catch (error) {
    return next(error);
  }
}

async function createChatbotScope(req, res, next) {
  try {
    const scopeKey = normalizeScopeKey(req.body.scopeKey || req.body.scope_key);
    const label = String(req.body.label || '').trim();
    const description = String(req.body.description || '').trim() || null;
    const sortOrder = Number(req.body.sortOrder || req.body.sort_order || 100);

    if (!scopeKey || !label) {
      return res.status(400).json({ message: 'Scope key and label are required.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO chatbot_scopes (scope_key, label, description, is_active, sort_order)
       VALUES (?, ?, ?, 1, ?)`,
      [scopeKey, label, description, sortOrder]
    );
    const [rows] = await pool.execute(
      `SELECT id, scope_key, label, description, is_active, sort_order, created_at, updated_at
       FROM chatbot_scopes
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ scope: mapScope(rows[0]) });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This scope key already exists.' });
    }

    return next(error);
  }
}

async function updateChatbotScope(req, res, next) {
  try {
    const id = Number(req.params.id);
    const scopeKey = normalizeScopeKey(req.body.scopeKey || req.body.scope_key);
    const label = String(req.body.label || '').trim();
    const description = String(req.body.description || '').trim() || null;
    const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive);
    const sortOrder = Number(req.body.sortOrder || req.body.sort_order || 100);

    if (!scopeKey || !label) {
      return res.status(400).json({ message: 'Scope key and label are required.' });
    }

    const [result] = await pool.execute(
      `UPDATE chatbot_scopes
       SET scope_key = ?, label = ?, description = ?, is_active = ?, sort_order = ?
       WHERE id = ?`,
      [scopeKey, label, description, isActive ? 1 : 0, sortOrder, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Scope was not found.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, scope_key, label, description, is_active, sort_order, created_at, updated_at
       FROM chatbot_scopes
       WHERE id = ?`,
      [id]
    );

    return res.json({ scope: mapScope(rows[0]) });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This scope key already exists.' });
    }

    return next(error);
  }
}

async function deleteChatbotScope(req, res, next) {
  try {
    const [result] = await pool.execute('DELETE FROM chatbot_scopes WHERE id = ?', [Number(req.params.id)]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Scope was not found.' });
    }

    return res.json({ message: 'Scope deleted.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createChatbotScope,
  deleteChatbotScope,
  listChatbotScopes,
  updateChatbotScope
};
