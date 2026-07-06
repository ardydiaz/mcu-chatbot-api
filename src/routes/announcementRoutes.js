const express = require('express');
const {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement
} = require('../controllers/announcementController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/announcements:
 *   get:
 *     summary: List university announcements
 *     tags:
 *       - Announcements
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of announcements
 */
router.get('/', listAnnouncements);

/**
 * @swagger
 * /api/announcements:
 *   post:
 *     summary: Create a university announcement
 *     tags:
 *       - Announcements
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               siteScope:
 *                 type: string
 *                 example: general
 *               title:
 *                 type: string
 *                 example: Enrollment starts tomorrow
 *               body:
 *                 type: string
 *                 example: Online enrollment opens tomorrow at 8:00 AM.
 *               priority:
 *                 type: string
 *                 enum: [normal, important, urgent]
 *                 example: important
 *               startDate:
 *                 type: string
 *                 format: date
 *                 example: 2026-07-01
 *               endDate:
 *                 type: string
 *                 format: date
 *                 example: 2026-07-05
 *     responses:
 *       201:
 *         description: Announcement created
 */
router.post('/', createAnnouncement);

/**
 * @swagger
 * /api/announcements/{id}:
 *   put:
 *     summary: Update a university announcement
 *     tags:
 *       - Announcements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Announcement updated
 */
router.put('/:id', updateAnnouncement);

/**
 * @swagger
 * /api/announcements/{id}:
 *   delete:
 *     summary: Delete a university announcement
 *     tags:
 *       - Announcements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Announcement deleted
 */
router.delete('/:id', deleteAnnouncement);

module.exports = router;
