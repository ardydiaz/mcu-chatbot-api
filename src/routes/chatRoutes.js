const express = require('express');
const { askQuestion, getTopics } = require('../controllers/chatController');

const router = express.Router();

router.get('/topics', getTopics);

/**
 * @swagger
 * /api/chat/ask:
 *   post:
 *     summary: Ask a question based on uploaded documents
 *     tags:
 *       - Chat
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
router.post('/ask', askQuestion);

module.exports = router;
