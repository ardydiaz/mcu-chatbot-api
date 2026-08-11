const pool = require('../utils/db');
const {
  jwtSecret,
  jwtExpiresIn,
  microsoftTenantId,
  microsoftClientId,
  microsoftAllowedDomain
} = require('../config/env');
const jwt = require('jsonwebtoken');

const LOGIN_PURPOSES = {
  ADMIN: 'admin',
  CHAT: 'chat'
};

let remoteJwks;

async function fetchMicrosoftProfilePhoto(graphAccessToken) {
  if (!graphAccessToken) {
    return null;
  }

  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
      headers: {
        Authorization: `Bearer ${graphAccessToken}`
      }
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    if (imageBuffer.length === 0 || imageBuffer.length > 256 * 1024) {
      return null;
    }

    return `data:${contentType};base64,${imageBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}

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
      role: user.role,
      approvalStatus: user.approval_status || user.approvalStatus || null
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

async function findOrCreateMicrosoftUser(profile, purpose = LOGIN_PURPOSES.ADMIN) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE microsoft_id = ? OR email = ? LIMIT 1',
    [profile.microsoftId, profile.email]
  );
  const existingUser = rows[0];
  const isChatLogin = purpose === LOGIN_PURPOSES.CHAT;

  if (existingUser) {
    if (isChatLogin) {
      const isApprovedAdmin = existingUser.role === 'admin' && existingUser.approval_status === 'approved';
      const chatRole = isApprovedAdmin ? 'admin' : 'student';
      const chatApprovalStatus = 'approved';

      await pool.execute(
        'UPDATE users SET name = ?, email = ?, microsoft_id = ?, role = ?, approval_status = ? WHERE id = ?',
        [profile.name, profile.email, profile.microsoftId, chatRole, chatApprovalStatus, existingUser.id]
      );

      return {
        id: existingUser.id,
        name: profile.name,
        email: profile.email,
        role: chatRole,
        approval_status: chatApprovalStatus
      };
    }

    if (existingUser.role !== 'admin') {
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, microsoft_id = ? WHERE id = ?',
        [profile.name, profile.email, profile.microsoftId, existingUser.id]
      );

      return {
        id: existingUser.id,
        name: profile.name,
        email: profile.email,
        role: existingUser.role || 'student',
        approval_status: existingUser.approval_status || 'approved'
      };
    }

    const adminApprovalStatus = existingUser.approval_status || 'pending';

    await pool.execute(
      'UPDATE users SET name = ?, email = ?, microsoft_id = ?, role = ?, approval_status = ? WHERE id = ?',
      [profile.name, profile.email, profile.microsoftId, 'admin', adminApprovalStatus, existingUser.id]
    );

    return {
      id: existingUser.id,
      name: profile.name,
      email: profile.email,
      role: 'admin',
      approval_status: adminApprovalStatus
    };
  }

  if (isChatLogin) {
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, microsoft_id, role, approval_status) VALUES (?, ?, NULL, ?, ?, ?)',
      [profile.name, profile.email, profile.microsoftId, 'student', 'approved']
    );

    return {
      id: result.insertId,
      name: profile.name,
      email: profile.email,
      role: 'student',
      approval_status: 'approved'
    };
  }

  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password, microsoft_id, role, approval_status) VALUES (?, ?, NULL, ?, ?, ?)',
    [profile.name, profile.email, profile.microsoftId, 'admin', 'pending']
  );

  return {
    id: result.insertId,
    name: profile.name,
    email: profile.email,
    role: 'admin',
    approval_status: 'pending'
  };
}

async function loginWithMicrosoft(idToken, options = {}) {
  const profile = await verifyMicrosoftIdToken(idToken);
  const purpose = options.purpose === LOGIN_PURPOSES.CHAT ? LOGIN_PURPOSES.CHAT : LOGIN_PURPOSES.ADMIN;
  const user = await findOrCreateMicrosoftUser(profile, purpose);

  if (purpose === LOGIN_PURPOSES.ADMIN && (user.role !== 'admin' || user.approval_status !== 'approved')) {
    const error = new Error(
      user.approval_status === 'rejected'
        ? 'Your admin access request was rejected.'
        : 'Your admin account is pending approval.'
    );
    error.status = 403;
    error.code = user.approval_status === 'rejected' ? 'APPROVAL_REJECTED' : 'APPROVAL_PENDING';
    error.approvalStatus = user.approval_status;
    throw error;
  }

  const photoUrl = await fetchMicrosoftProfilePhoto(options.graphAccessToken);
  const responseUser = photoUrl ? { ...user, photoUrl } : user;

  return {
    user: responseUser,
    token: signApiUser(user)
  };
}

module.exports = {
  LOGIN_PURPOSES,
  loginWithMicrosoft
};
