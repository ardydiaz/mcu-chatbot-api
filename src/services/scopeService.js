const pool = require('../utils/db');

const fallbackScopes = [
  { scopeKey: 'general', label: 'General Chatbot', description: 'Main university chatbot scope.', isActive: true, sortOrder: 10 },
  { scopeKey: 'queue', label: 'Queue System', description: 'Queue system embedded chatbot scope.', isActive: true, sortOrder: 20 },
  { scopeKey: 'post-class', label: 'Post Class', description: 'Post-class survey embedded chatbot scope.', isActive: true, sortOrder: 30 }
];

function normalizeScopeKey(value) {
  return String(value || 'general')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .trim() || 'general';
}

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

async function listScopes({ activeOnly = false } = {}) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, scope_key, label, description, is_active, sort_order, created_at, updated_at
       FROM chatbot_scopes
       ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order ASC, label ASC`
    );

    if (rows.length > 0) {
      return rows.map(mapScope);
    }
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') {
      throw error;
    }
  }

  return activeOnly ? fallbackScopes.filter((scope) => scope.isActive) : fallbackScopes;
}

async function isKnownScope(scopeKey) {
  const normalizedScope = normalizeScopeKey(scopeKey);
  const scopes = await listScopes({ activeOnly: true });

  return scopes.some((scope) => scope.scopeKey === normalizedScope);
}

async function normalizeScope(value) {
  const normalizedScope = normalizeScopeKey(value);

  return await isKnownScope(normalizedScope) ? normalizedScope : 'general';
}

module.exports = {
  fallbackScopes,
  listScopes,
  normalizeScope,
  normalizeScopeKey
};
