const pool = require('../utils/db');
const bcrypt = require('bcryptjs');

function mapAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    microsoftId: account.microsoft_id,
    role: account.role,
    approvalStatus: account.approval_status || 'pending',
    approvedAt: account.approved_at,
    approvedBy: account.approved_by,
    hasPassword: Boolean(account.password),
    createdAt: account.created_at
  };
}

async function listAccounts(req, res, next) {
  try {
    const [accounts] = await pool.execute(
      `SELECT id, name, email, microsoft_id, role, approval_status, approved_at, approved_by, password, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json({
      users: accounts.map(mapAccount)
    });
  } catch (error) {
    return next(error);
  }
}

async function setApprovalStatus({ userId, approvalStatus, approvedByUserId }) {
  const approvedAt = approvalStatus === 'approved' ? new Date() : null;
  const approvedBy = approvalStatus === 'approved' ? approvedByUserId : null;

  const [result] = await pool.execute(
    `UPDATE users
     SET approval_status = ?, approved_at = ?, approved_by = ?
     WHERE id = ?`,
    [approvalStatus, approvedAt, approvedBy, userId]
  );

  if (result.affectedRows === 0) {
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT id, name, email, microsoft_id, role, approval_status, approved_at, approved_by, password, created_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return mapAccount(rows[0]);
}

async function updateApprovalStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { approvalStatus } = req.body;
    const allowedStatuses = ['approved', 'rejected', 'pending'];

    if (!allowedStatuses.includes(approvalStatus)) {
      return res.status(400).json({ message: 'approvalStatus must be approved, rejected, or pending.' });
    }

    const user = await setApprovalStatus({
      userId: id,
      approvalStatus,
      approvedByUserId: req.user.id
    });

    if (!user) {
      return res.status(404).json({ message: 'User was not found.' });
    }

    return res.json({
      user
    });
  } catch (error) {
    return next(error);
  }
}

async function approveUser(req, res, next) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required.' });
    }

    const user = await setApprovalStatus({
      userId,
      approvalStatus: 'approved',
      approvedByUserId: req.user.id
    });

    if (!user) {
      return res.status(404).json({ message: 'User was not found.' });
    }

    return res.json({
      message: 'User approved successfully.',
      user
    });
  } catch (error) {
    return next(error);
  }
}

async function setUserPassword(req, res, next) {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({ message: 'userId and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, microsoft_id, role, approval_status, approved_at, approved_by, password, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ message: 'User was not found.' });
    }

    if (user.approval_status !== 'approved') {
      return res.status(403).json({ message: 'User must be approved before setting an API password.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    return res.json({
      message: 'User password was set successfully.',
      user: mapAccount({
        ...user,
        password: hashedPassword
      })
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  approveUser,
  listAccounts,
  setUserPassword,
  updateApprovalStatus
};
