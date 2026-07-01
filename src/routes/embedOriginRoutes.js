const express = require('express');
const {
  createEmbedOrigin,
  deleteEmbedOrigin,
  listEmbedOrigins,
  updateEmbedOrigin
} = require('../controllers/embedOriginController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/embed-origins:
 *   get:
 *     summary: List allowed chatbot embed websites
 *     description: Returns the website origins that are allowed to embed each chatbot scope.
 *     tags:
 *       - Embed Access
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of allowed website origins
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 origins:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       siteScope:
 *                         type: string
 *                         example: post-class
 *                       origin:
 *                         type: string
 *                         example: http://postclasssurvey.test
 *                       label:
 *                         type: string
 *                         example: Post-Class Survey
 *                       isActive:
 *                         type: boolean
 *                         example: true
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
router.get('/', listEmbedOrigins);

/**
 * @swagger
 * /api/embed-origins:
 *   post:
 *     summary: Add an allowed chatbot embed website
 *     description: Adds a website origin that can embed a specific chatbot scope.
 *     tags:
 *       - Embed Access
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - siteScope
 *               - origin
 *             properties:
 *               siteScope:
 *                 type: string
 *                 enum: [general, queue, post-class]
 *                 example: post-class
 *               origin:
 *                 type: string
 *                 example: http://postclasssurvey.test
 *               label:
 *                 type: string
 *                 example: Post-Class Survey
 *     responses:
 *       201:
 *         description: Website origin added
 *       400:
 *         description: Valid website origin is required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       409:
 *         description: Website already exists for the selected scope
 */
router.post('/', createEmbedOrigin);

/**
 * @swagger
 * /api/embed-origins/{id}:
 *   put:
 *     summary: Update an allowed chatbot embed website
 *     description: Updates the scope, origin, label, or active status of an allowed website.
 *     tags:
 *       - Embed Access
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
 *               - siteScope
 *               - origin
 *             properties:
 *               siteScope:
 *                 type: string
 *                 enum: [general, queue, post-class]
 *                 example: post-class
 *               origin:
 *                 type: string
 *                 example: http://postclasssurvey.test
 *               label:
 *                 type: string
 *                 example: Post-Class Survey
 *               isActive:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Website origin updated
 *       400:
 *         description: Valid website origin is required
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       404:
 *         description: Website access record was not found
 *       409:
 *         description: Website already exists for the selected scope
 */
router.put('/:id', updateEmbedOrigin);

/**
 * @swagger
 * /api/embed-origins/{id}:
 *   delete:
 *     summary: Remove an allowed chatbot embed website
 *     description: Deletes a website origin from the chatbot embed allowlist.
 *     tags:
 *       - Embed Access
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
 *         description: Website access record deleted
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Admin access is required
 *       404:
 *         description: Website access record was not found
 */
router.delete('/:id', deleteEmbedOrigin);

module.exports = router;
