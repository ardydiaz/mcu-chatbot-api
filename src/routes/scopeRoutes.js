const express = require('express');
const {
  createChatbotScope,
  deleteChatbotScope,
  listChatbotScopes,
  updateChatbotScope
} = require('../controllers/scopeController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/chatbot-scopes:
 *   get:
 *     summary: List chatbot scopes
 *     description: Returns the target website scopes used for document uploads, embed generation, and website access rules.
 *     tags:
 *       - Chatbot Scopes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: activeOnly
 *         required: false
 *         schema:
 *           type: boolean
 *         example: true
 *         description: When true, returns only active scopes.
 *     responses:
 *       200:
 *         description: List of chatbot scopes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 scopes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       scopeKey:
 *                         type: string
 *                         example: post-class
 *                       label:
 *                         type: string
 *                         example: Post Class
 *                       description:
 *                         type: string
 *                         example: Post-class survey embedded chatbot scope.
 *                       isActive:
 *                         type: boolean
 *                         example: true
 *                       sortOrder:
 *                         type: integer
 *                         example: 30
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 */
router.get('/', listChatbotScopes);

/**
 * @swagger
 * /api/chatbot-scopes:
 *   post:
 *     summary: Create a chatbot scope
 *     description: Adds a new target website scope that can be used for uploads, embed generation, and website access.
 *     tags:
 *       - Chatbot Scopes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scopeKey
 *               - label
 *             properties:
 *               scopeKey:
 *                 type: string
 *                 example: library
 *               label:
 *                 type: string
 *                 example: Library Website
 *               description:
 *                 type: string
 *                 example: Library chatbot scope.
 *               sortOrder:
 *                 type: integer
 *                 example: 40
 *     responses:
 *       201:
 *         description: Scope created
 *       400:
 *         description: Scope key and label are required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       409:
 *         description: Scope key already exists
 */
router.post('/', createChatbotScope);

/**
 * @swagger
 * /api/chatbot-scopes/{id}:
 *   put:
 *     summary: Update a chatbot scope
 *     description: Updates the key, label, description, active status, or sort order of a chatbot scope.
 *     tags:
 *       - Chatbot Scopes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scopeKey
 *               - label
 *             properties:
 *               scopeKey:
 *                 type: string
 *                 example: library
 *               label:
 *                 type: string
 *                 example: Library Website
 *               description:
 *                 type: string
 *                 example: Library chatbot scope.
 *               isActive:
 *                 type: boolean
 *                 example: true
 *               sortOrder:
 *                 type: integer
 *                 example: 40
 *     responses:
 *       200:
 *         description: Scope updated
 *       400:
 *         description: Scope key and label are required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       404:
 *         description: Scope was not found
 *       409:
 *         description: Scope key already exists
 */
router.put('/:id', updateChatbotScope);

/**
 * @swagger
 * /api/chatbot-scopes/{id}:
 *   delete:
 *     summary: Delete a chatbot scope
 *     description: Removes a chatbot scope from the available target website scope list.
 *     tags:
 *       - Chatbot Scopes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: Scope deleted
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       404:
 *         description: Scope was not found
 */
router.delete('/:id', deleteChatbotScope);

module.exports = router;
