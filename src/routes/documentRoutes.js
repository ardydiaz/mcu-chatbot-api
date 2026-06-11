const express = require('express');
const { uploadDocument, listDocuments } = require('../controllers/documentController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { uploadPdf } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.get('/', authenticate, listDocuments);
router.post('/upload', authenticate, requireAdmin, uploadPdf.single('pdf'), uploadDocument);

module.exports = router;
