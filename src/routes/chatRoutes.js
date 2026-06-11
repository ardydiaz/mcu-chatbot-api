const express = require('express');
const { askQuestion } = require('../controllers/chatController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @swagger
 * /api/chat/ask:
 *   post:
 *     summary: Ask a question based on uploaded documents
 *     tags:
 *       - Chat
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 example: what is the Disbursement Authorization
 *     responses:
 *       200:
 *         description: Chatbot answer with matching text, images, and sources
 */
router.post('/ask', authenticate, askQuestion);

module.exports = router;
