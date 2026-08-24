const express = require('express');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { askQuestion, getTopics } = require('../controllers/chatController');

const router = express.Router();
const chatRateBuckets = new Map();
const expensiveChatBuckets = new Map();
const duplicateQuestionBuckets = new Map();
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const CHAT_RATE_MAX_REQUESTS = 30;
const EXPENSIVE_CHAT_WINDOW_MS = 60 * 1000;
const EXPENSIVE_CHAT_MAX_REQUESTS = 12;
const DUPLICATE_QUESTION_WINDOW_MS = 20 * 1000;

function getRequestIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
}

function getRequesterKey(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${getRequestIp(req)}`;
}

function normalizeQuestion(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanupExpiredBuckets(bucketMap, now) {
  if (bucketMap.size <= 5000) {
    return;
  }

  for (const [bucketKey, bucketValue] of bucketMap.entries()) {
    if (bucketValue.resetAt <= now || bucketValue.expiresAt <= now) {
      bucketMap.delete(bucketKey);
    }
  }
}

function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, jwtSecret);
  } catch {
    req.user = null;
  }

  return next();
}

function chatRateLimit(req, res, next) {
  const now = Date.now();
  const key = getRequesterKey(req);
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

  cleanupExpiredBuckets(chatRateBuckets, now);

  return next();
}

function expensiveChatLimit(req, res, next) {
  const now = Date.now();
  const key = getRequesterKey(req);
  const bucket = expensiveChatBuckets.get(key) || { count: 0, resetAt: now + EXPENSIVE_CHAT_WINDOW_MS };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + EXPENSIVE_CHAT_WINDOW_MS;
  }

  bucket.count += 1;
  expensiveChatBuckets.set(key, bucket);

  if (bucket.count > EXPENSIVE_CHAT_MAX_REQUESTS) {
    return res.status(429).json({
      message: 'You are sending questions too quickly. Please wait a moment before asking again.'
    });
  }

  cleanupExpiredBuckets(expensiveChatBuckets, now);

  return next();
}

function duplicateQuestionLimit(req, res, next) {
  const now = Date.now();
  const question = normalizeQuestion(req.body?.message);

  if (!question) {
    return next();
  }

  const key = `${getRequesterKey(req)}:${question}`;
  const existing = duplicateQuestionBuckets.get(key);

  if (existing?.expiresAt > now) {
    return res.status(429).json({
      message: 'You already sent the same question. Please wait for the answer or ask a different question.'
    });
  }

  duplicateQuestionBuckets.set(key, {
    expiresAt: now + DUPLICATE_QUESTION_WINDOW_MS
  });
  cleanupExpiredBuckets(duplicateQuestionBuckets, now);

  return next();
}

router.get('/topics', optionalAuthenticate, getTopics);

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
router.post('/ask', optionalAuthenticate, chatRateLimit, duplicateQuestionLimit, expensiveChatLimit, askQuestion);

module.exports = router;
