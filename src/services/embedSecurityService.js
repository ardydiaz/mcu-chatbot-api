const { embedScopeOrigins } = require('../config/env');
const pool = require('../utils/db');

const defaultScopeOrigins = {
  general: ['https://chatbot.mcu.edu.ph', 'http://chatbot.mcu.edu.ph'],
  queue: ['https://queue.mcu.edu.ph'],
  'post-class': ['https://postclasssurvey.mcu.edu.ph']
};

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(String(value)).origin.toLowerCase();
  } catch {
    return '';
  }
}

function parseConfiguredScopeOrigins() {
  return String(embedScopeOrigins || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((scopeMap, entry) => {
      const [rawScope, rawOrigins] = entry.split('=');
      const scope = String(rawScope || '').trim().toLowerCase();

      if (!scope || !rawOrigins) {
        return scopeMap;
      }

      const origins = rawOrigins
        .split('|')
        .map(normalizeOrigin)
        .filter(Boolean);

      if (origins.length > 0) {
        scopeMap[scope] = origins;
      }

      return scopeMap;
    }, {});
}

function getAllowedOriginsForScope(scope) {
  const configuredOrigins = parseConfiguredScopeOrigins();
  const scopeOrigins = configuredOrigins[scope] || defaultScopeOrigins[scope] || [];

  return new Set(scopeOrigins.map(normalizeOrigin).filter(Boolean));
}

async function getDatabaseOriginsForScope(scope) {
  try {
    const [rows] = await pool.execute(
      `SELECT origin
       FROM embed_allowed_origins
       WHERE site_scope = ? AND is_active = 1`,
      [scope]
    );

    return rows.map((row) => normalizeOrigin(row.origin)).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }

    throw error;
  }
}

async function isAllowedEmbedOrigin(scope, originValue) {
  const origin = normalizeOrigin(originValue);

  if (!origin) {
    return false;
  }

  const allowedOrigins = getAllowedOriginsForScope(scope);
  const databaseOrigins = await getDatabaseOriginsForScope(scope);

  databaseOrigins.forEach((databaseOrigin) => allowedOrigins.add(databaseOrigin));

  return allowedOrigins.has(origin);
}

function getForbiddenEmbedMessage() {
  return 'This chatbot embed is not authorized for this website.';
}

module.exports = {
  getForbiddenEmbedMessage,
  isAllowedEmbedOrigin,
  normalizeOrigin
};
