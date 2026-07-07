const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const { loginWithMicrosoft } = require('../services/microsoftAuthService');

function signUser(user) {
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

function isApprovalRequired(user) {
  return user.role === 'admin' && user.approval_status !== undefined;
}

function respondIfNotApproved(user, res) {
  if (!isApprovalRequired(user) || user.approval_status === 'approved') {
    return false;
  }

  res.status(403).json({
    code: user.approval_status === 'rejected' ? 'APPROVAL_REJECTED' : 'APPROVAL_PENDING',
    message: user.approval_status === 'rejected'
      ? 'Your admin access request was rejected.'
      : 'Your admin account is pending approval.',
    approvalStatus: user.approval_status
  });

  return true;
}

async function register(req, res, next) {
  try {
    const { name, email, password, role = 'student' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const approvalStatus = role === 'admin' ? 'pending' : 'approved';
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role, approval_status) VALUES (?, ?, ?, ?, ?)',
      [name, email.toLowerCase(), hashedPassword, role, approvalStatus]
    );

    const user = {
      id: result.insertId,
      name,
      email: email.toLowerCase(),
      role,
      approval_status: approvalStatus
    };

    if (role === 'admin') {
      return res.status(202).json({
        code: 'APPROVAL_PENDING',
        message: 'Your admin account is pending approval.',
        user
      });
    }

    return res.status(201).json({
      user,
      token: signUser(user)
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase();
    const [userRows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    const [apiAccountRows] = userRows[0]
      ? [[]]
      : await pool.execute('SELECT * FROM api_account WHERE email = ? LIMIT 1', [normalizedEmail]);
    const user = userRows[0] || apiAccountRows[0];

    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      approval_status: user.approval_status
    };

    if (respondIfNotApproved(safeUser, res)) {
      return;
    }

    return res.json({
      user: safeUser,
      token: signUser(safeUser)
    });
  } catch (error) {
    return next(error);
  }
}

async function microsoftLogin(req, res, next) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Microsoft idToken is required.' });
    }

    const result = await loginWithMicrosoft(idToken);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register,
  login,
  microsoftLogin
};
