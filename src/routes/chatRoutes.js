const express = require('express');
const { askQuestion } = require('../controllers/chatController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/ask', authenticate, askQuestion);

module.exports = router;
