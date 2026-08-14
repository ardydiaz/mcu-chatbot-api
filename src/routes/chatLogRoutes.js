const express = require('express');
const { listChatLogs } = require('../controllers/chatLogController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', authenticate, requireAdmin, listChatLogs);

module.exports = router;
