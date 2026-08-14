const pool = require('../utils/db');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
let hasUserAccountIdColumnCache = null;

function normalizePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSearch(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function mapChatLog(row) {
  const userAccountId = row.user_account_id || null;

  return {
    id: row.id,
    userId: userAccountId || row.user_id || null,
    userSource: userAccountId ? 'users' : (row.user_id ? 'api_account' : 'guest'),
    userName: row.user_name || row.api_user_name || 'Guest',
    userEmail: row.user_email || row.api_user_email || '',
    userRole: row.user_role || row.api_user_role || 'guest',
    message: row.message,
    response: row.response,
    createdAt: row.created_at
  };
}

async function hasUserAccountIdColumn() {
  if (hasUserAccountIdColumnCache !== null) {
    return hasUserAccountIdColumnCache;
  }

  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'chat_logs'
       AND COLUMN_NAME = 'user_account_id'`
  );

  hasUserAccountIdColumnCache = Number(rows[0]?.total || 0) > 0;
  return hasUserAccountIdColumnCache;
}

async function listChatLogs(req, res, next) {
  try {
    const page = normalizePositiveInt(req.query.page, 1);
    const pageSize = normalizePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const search = normalizeSearch(req.query.search);
    const canJoinUsers = await hasUserAccountIdColumn();
    const userJoinSql = canJoinUsers ? 'LEFT JOIN users u ON u.id = cl.user_account_id' : '';
    const userSearchSql = canJoinUsers ? 'OR u.name LIKE ? OR u.email LIKE ?' : '';
    const userSelectSql = canJoinUsers
      ? `cl.user_account_id,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role,`
      : `NULL AS user_account_id,
        NULL AS user_name,
        NULL AS user_email,
        NULL AS user_role,`;
    const filters = [];
    const params = [];

    if (search) {
      filters.push(`(
        cl.message LIKE ?
        OR cl.response LIKE ?
        ${userSearchSql}
        OR api_user.name LIKE ?
        OR api_user.email LIKE ?
      )`);
      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue);
      if (canJoinUsers) {
        params.push(searchValue, searchValue);
      }
      params.push(searchValue, searchValue);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM chat_logs cl
       ${userJoinSql}
       LEFT JOIN api_account api_user ON api_user.id = cl.user_id
       ${whereClause}`,
      params
    );
    const [rows] = await pool.execute(
      `SELECT
        cl.id,
        cl.user_id,
        ${userSelectSql}
        cl.message,
        cl.response,
        cl.created_at,
        api_user.name AS api_user_name,
        api_user.email AS api_user_email,
        api_user.role AS api_user_role
       FROM chat_logs cl
       ${userJoinSql}
       LEFT JOIN api_account api_user ON api_user.id = cl.user_id
       ${whereClause}
       ORDER BY cl.created_at DESC, cl.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    return res.json({
      logs: rows.map(mapChatLog),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listChatLogs
};
