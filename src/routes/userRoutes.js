const express = require('express');
const {
  approveUser,
  listAccounts,
  setUserPassword,
  updateApprovalStatus,
  updateUserRole
} = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List users waiting for admin approval
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 */
router.get('/', authenticate, requireAdmin, listAccounts);

/**
 * @swagger
 * /api/users/approve:
 *   post:
 *     summary: Approve a user for admin access
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 3
 *     responses:
 *       200:
 *         description: User approved successfully
 *       400:
 *         description: userId is required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 *       404:
 *         description: User was not found
 *   patch:
 *     summary: Approve a user for admin access
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 3
 *     responses:
 *       200:
 *         description: User approved successfully
 *       400:
 *         description: userId is required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 *       404:
 *         description: User was not found
 */
router.post('/approve', authenticate, requireAdmin, approveUser);
router.patch('/approve', authenticate, requireAdmin, approveUser);

/**
 * @swagger
 * /api/users/password:
 *   patch:
 *     summary: Set an API password for an approved Microsoft 365 user
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - password
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 3
 *               password:
 *                 type: string
 *                 example: NewPassword123!
 *     responses:
 *       200:
 *         description: User password was set successfully
 *       400:
 *         description: userId and password are required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: User must be approved before setting an API password
 *       404:
 *         description: User was not found
 */
router.patch('/password', authenticate, requireAdmin, setUserPassword);

/**
 * @swagger
 * /api/users/{id}/approval:
 *   patch:
 *     summary: Update a user's approval status
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 3
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - approvalStatus
 *             properties:
 *               approvalStatus:
 *                 type: string
 *                 enum: [approved, rejected, pending]
 *                 example: approved
 *     responses:
 *       200:
 *         description: User approval status updated
 *       400:
 *         description: Invalid approval status
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 *       404:
 *         description: User was not found
 */
router.patch('/:id/approval', authenticate, requireAdmin, updateApprovalStatus);

/**
 * @swagger
 * /api/users/{id}/role:
 *   patch:
 *     summary: Change a user's role
 *     description: Promote a user to approved admin access or change the user back to approved student access. Requires an approved admin session.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 3
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [student, admin]
 *                 example: admin
 *     responses:
 *       200:
 *         description: User role updated
 *       400:
 *         description: Invalid role or unsafe role change
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 *       404:
 *         description: User was not found
 */
router.patch('/:id/role', authenticate, requireAdmin, updateUserRole);

module.exports = router;
