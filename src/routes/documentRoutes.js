const express = require('express');
const { uploadDocument, listDocuments } = require('../controllers/documentController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { uploadPdf } = require('../middleware/uploadMiddleware');

const router = express.Router();

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: List uploaded documents
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of uploaded documents
 */
router.get('/', authenticate, listDocuments);

/**
 * @swagger
 * /api/documents/upload:
 *   post:
 *     summary: Upload and process a PDF document
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - pdf
 *             properties:
 *               pdf:
 *                 type: string
 *                 format: binary
 *               title:
 *                 type: string
 *                 example: DPCManual
 *     responses:
 *       201:
 *         description: Document uploaded and processed
 */
router.post('/upload', authenticate, requireAdmin, uploadPdf.single('pdf'), uploadDocument);

module.exports = router;
