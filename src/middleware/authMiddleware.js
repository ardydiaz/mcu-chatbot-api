const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const pool = require('../utils/db');

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token is required.' });
  }

  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

async function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  if (req.user?.approvalStatus !== 'approved') {
    return res.status(403).json({
      code: 'APPROVAL_REQUIRED',
      message: 'Approved admin access is required.'
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT role, approval_status FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    const currentUser = rows[0];

    if (!currentUser || currentUser.role !== 'admin' || currentUser.approval_status !== 'approved') {
      return res.status(403).json({
        code: 'ADMIN_ACCESS_REVOKED',
        message: 'Approved admin access is required.'
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  authenticate,
  requireAdmin
};
