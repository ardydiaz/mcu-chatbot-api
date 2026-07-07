const express = require('express');
const {
  exportWebsiteImportWord,
  previewWebsiteImport
} = require('../controllers/websiteImportController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/website-import/preview:
 *   post:
 *     summary: Preview website crawl
 *     tags:
 *       - Website Import
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Crawled pages preview
 */
router.post('/preview', previewWebsiteImport);

/**
 * @swagger
 * /api/website-import/export-word:
 *   post:
 *     summary: Export crawled website pages as a Word document
 *     tags:
 *       - Website Import
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Word-compatible document download
 */
router.post('/export-word', exportWebsiteImportWord);

module.exports = router;
