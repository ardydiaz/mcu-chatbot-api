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

async function getAccountById(userId) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, microsoft_id, role, approval_status, approved_at, approved_by, password, created_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
}

async function hasAnotherApprovedAdmin(userId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM users
     WHERE role = 'admin'
       AND approval_status = 'approved'
       AND id <> ?`,
    [userId]
  );

  return Number(rows[0]?.total || 0) > 0;
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

    const currentUser = await getAccountById(id);

    if (!currentUser) {
      return res.status(404).json({ message: 'User was not found.' });
    }

    if (Number(id) === Number(req.user.id) && approvalStatus !== 'approved') {
      return res.status(400).json({ message: 'You cannot remove approval from your own admin account.' });
    }

    if (
      currentUser.role === 'admin' &&
      currentUser.approval_status === 'approved' &&
      approvalStatus !== 'approved' &&
      !(await hasAnotherApprovedAdmin(id))
    ) {
      return res.status(400).json({ message: 'At least one approved admin account must remain active.' });
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

async function updateUserRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const allowedRoles = ['student', 'admin'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'role must be student or admin.' });
    }

    const currentUser = await getAccountById(id);

    if (!currentUser) {
      return res.status(404).json({ message: 'User was not found.' });
    }

    if (Number(id) === Number(req.user.id) && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot remove your own admin role.' });
    }

    if (
      currentUser.role === 'admin' &&
      currentUser.approval_status === 'approved' &&
      role !== 'admin' &&
      !(await hasAnotherApprovedAdmin(id))
    ) {
      return res.status(400).json({ message: 'At least one approved admin account must remain active.' });
    }

    const approvalStatus = 'approved';
    const approvedAt = new Date();
    const approvedBy = req.user.id;

    await pool.execute(
      `UPDATE users
       SET role = ?, approval_status = ?, approved_at = ?, approved_by = ?
       WHERE id = ?`,
      [role, approvalStatus, approvedAt, approvedBy, id]
    );

    const updatedUser = await getAccountById(id);

    return res.json({
      message: role === 'admin'
        ? 'User was promoted to approved admin successfully.'
        : 'User was changed to approved student successfully.',
      user: mapAccount(updatedUser)
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
  updateApprovalStatus,
  updateUserRole
};
