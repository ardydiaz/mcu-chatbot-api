const express = require('express');
const { askQuestion, getTopics } = require('../controllers/chatController');

const router = express.Router();
const chatRateBuckets = new Map();
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const CHAT_RATE_MAX_REQUESTS = 30;

function getRequestIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
}

function chatRateLimit(req, res, next) {
  const now = Date.now();
  const key = getRequestIp(req);
  const bucket = chatRateBuckets.get(key) || { count: 0, resetAt: now + CHAT_RATE_WINDOW_MS };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + CHAT_RATE_WINDOW_MS;
  }

  bucket.count += 1;
  chatRateBuckets.set(key, bucket);

  if (bucket.count > CHAT_RATE_MAX_REQUESTS) {
    return res.status(429).json({ message: 'Too many chat requests. Please wait a moment and try again.' });
  }

  if (chatRateBuckets.size > 5000) {
    for (const [bucketKey, bucketValue] of chatRateBuckets.entries()) {
      if (bucketValue.resetAt <= now) {
        chatRateBuckets.delete(bucketKey);
      }
    }
  }

  return next();
}

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
 *                 maxLength: 2000
 *                 example: what is the Disbursement Authorization
 *     responses:
 *       200:
 *         description: Chatbot answer with matching text, images, and sources
 *       413:
 *         description: Message is too long
 *       429:
 *         description: Too many chat requests
 */
router.post('/ask', chatRateLimit, askQuestion);

module.exports = router;
