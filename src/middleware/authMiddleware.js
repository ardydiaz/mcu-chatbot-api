const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

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

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  if (req.user?.approvalStatus !== 'approved') {
    return res.status(403).json({
      code: 'APPROVAL_REQUIRED',
      message: 'Approved admin access is required.'
    });
  }

  return next();
}

module.exports = {
  authenticate,
  requireAdmin
};
