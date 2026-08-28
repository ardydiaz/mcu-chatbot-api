const express = require('express');
const {
  getDocument,
  getLibraryDocumentPreview,
  listLibraryDocuments,
  uploadDocument,
  listDocuments
} = require('../controllers/documentController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { uploadDocumentFile } = require('../middleware/uploadMiddleware');

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
 *       403:
 *         description: Approved admin access is required
 */
router.get('/', authenticate, requireAdmin, listDocuments);

/**
 * @swagger
 * /api/documents/library:
 *   get:
 *     summary: List uploaded documents for the chatbot Library
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Read-only document metadata for authenticated chatbot users
 *       401:
 *         description: Authorization token is required
 */
router.get('/library', authenticate, listLibraryDocuments);

/**
 * @swagger
 * /api/documents/library/{id}/preview:
 *   get:
 *     summary: Get or generate a browser preview for an uploaded Library document
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 36
 *     responses:
 *       200:
 *         description: Browser preview URL for the uploaded document
 *       401:
 *         description: Authorization token is required
 *       404:
 *         description: Document was not found
 *       422:
 *         description: File type cannot be previewed in the browser
 */
router.get('/library/:id/preview', authenticate, getLibraryDocumentPreview);

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: View uploaded document details and extracted content
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 36
 *     responses:
 *       200:
 *         description: Document details with extracted text and images
 *       401:
 *         description: Authorization token is required
 *       403:
 *         description: Approved admin access is required
 *       404:
 *         description: Document was not found
 */
router.get('/:id', authenticate, requireAdmin, getDocument);

/**
 * @swagger
 * /api/documents/upload:
 *   post:
 *     summary: Upload and process a PDF, Word, or text document
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
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF, DOC, DOCX, or TXT file
 *               title:
 *                 type: string
 *                 example: DPCManual
 *               siteScope:
 *                 type: string
 *                 example: general
 *               topicCategory:
 *                 type: string
 *                 example: Admissions
 *               suggestedPrompt:
 *                 type: string
 *                 example: What are the admission requirements?
 *               showAsTopic:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       201:
 *         description: Document uploaded and processed
 */
router.post(
  '/upload',
  authenticate,
  requireAdmin,
  uploadDocumentFile.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ]),
  uploadDocument
);

module.exports = router;
