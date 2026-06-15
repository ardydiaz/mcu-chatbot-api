const pool = require('../utils/db');
const {
  jwtSecret,
  jwtExpiresIn,
  microsoftTenantId,
  microsoftClientId,
  microsoftAllowedDomain
} = require('../config/env');
const jwt = require('jsonwebtoken');

let remoteJwks;

async function verifyMicrosoftIdToken(idToken) {
  if (!microsoftTenantId || !microsoftClientId) {
    const error = new Error('Microsoft SSO is not configured.');
    error.status = 500;
    throw error;
  }

  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const issuer = `https://login.microsoftonline.com/${microsoftTenantId}/v2.0`;

  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${microsoftTenantId}/discovery/v2.0/keys`)
    );
  }

  const { payload } = await jwtVerify(idToken, remoteJwks, {
    issuer,
    audience: microsoftClientId
  });

  const email = (payload.preferred_username || payload.email || payload.upn || '').toLowerCase();

  if (!email) {
    const error = new Error('Microsoft account email was not found in the token.');
    error.status = 401;
    throw error;
  }

  if (microsoftAllowedDomain && !email.endsWith(`@${microsoftAllowedDomain.toLowerCase()}`)) {
    const error = new Error(`Only ${microsoftAllowedDomain} Microsoft accounts are allowed.`);
    error.status = 403;
    throw error;
  }

  return {
    microsoftId: payload.oid || payload.sub,
    name: payload.name || email,
    email
  };
}

function signApiUser(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

async function findOrCreateMicrosoftUser(profile) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE microsoft_id = ? OR email = ? LIMIT 1',
    [profile.microsoftId, profile.email]
  );
  const existingUser = rows[0];

  if (existingUser) {
    if (existingUser.role !== 'admin' || existingUser.microsoft_id !== profile.microsoftId) {
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, microsoft_id = ?, role = ? WHERE id = ?',
        [profile.name, profile.email, profile.microsoftId, 'admin', existingUser.id]
      );
    }

    return {
      id: existingUser.id,
      name: profile.name,
      email: profile.email,
      role: 'admin'
    };
  }

  const [result] = await pool.execute(
    'INSERT INTO users (name, email, microsoft_id, role) VALUES (?, ?, ?, ?)',
    [profile.name, profile.email, profile.microsoftId, 'admin']
  );

  return {
    id: result.insertId,
    name: profile.name,
    email: profile.email,
    role: 'admin'
  };
}

async function loginWithMicrosoft(idToken) {
  const profile = await verifyMicrosoftIdToken(idToken);
  const user = await findOrCreateMicrosoftUser(profile);

  return {
    user,
    token: signApiUser(user)
  };
}

module.exports = {
  loginWithMicrosoft
};
