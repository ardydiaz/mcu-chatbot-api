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
      role: user.role
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

async function register(req, res, next) {
  try {
    const { name, email, password, role = 'student' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO api_account (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role]
    );

    const user = { id: result.insertId, name, email, role };

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

    const [rows] = await pool.execute('SELECT * FROM api_account WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];

    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

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
