const pool = require('../utils/db');
const { mapAnnouncement } = require('../services/announcementService');
const { normalizeScope } = require('../services/scopeService');

function normalizePriority(value) {
  const priority = String(value || 'normal').toLowerCase();

  return ['normal', 'important', 'urgent'].includes(priority) ? priority : 'normal';
}

function normalizeDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

async function listAnnouncements(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, site_scope, title, body, priority, start_date, end_date, is_active, created_at, updated_at
       FROM announcements
       ORDER BY created_at DESC`
    );

    return res.json({ announcements: rows.map(mapAnnouncement) });
  } catch (error) {
    return next(error);
  }
}

async function createAnnouncement(req, res, next) {
  try {
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    const priority = normalizePriority(req.body.priority);
    const startDate = normalizeDate(req.body.startDate || req.body.start_date);
    const endDate = normalizeDate(req.body.endDate || req.body.end_date);

    if (!title || !body) {
      return res.status(400).json({ message: 'Announcement title and message are required.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO announcements (site_scope, title, body, priority, start_date, end_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [siteScope, title, body, priority, startDate, endDate]
    );
    const [rows] = await pool.execute(
      `SELECT id, site_scope, title, body, priority, start_date, end_date, is_active, created_at, updated_at
       FROM announcements
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ announcement: mapAnnouncement(rows[0]) });
  } catch (error) {
    return next(error);
  }
}

async function updateAnnouncement(req, res, next) {
  try {
    const id = Number(req.params.id);
    const siteScope = await normalizeScope(req.body.siteScope || req.body.site_scope);
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    const priority = normalizePriority(req.body.priority);
    const startDate = normalizeDate(req.body.startDate || req.body.start_date);
    const endDate = normalizeDate(req.body.endDate || req.body.end_date);
    const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive);

    if (!title || !body) {
      return res.status(400).json({ message: 'Announcement title and message are required.' });
    }

    const [result] = await pool.execute(
      `UPDATE announcements
       SET site_scope = ?, title = ?, body = ?, priority = ?, start_date = ?, end_date = ?, is_active = ?
       WHERE id = ?`,
      [siteScope, title, body, priority, startDate, endDate, isActive ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Announcement was not found.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, site_scope, title, body, priority, start_date, end_date, is_active, created_at, updated_at
       FROM announcements
       WHERE id = ?`,
      [id]
    );

    return res.json({ announcement: mapAnnouncement(rows[0]) });
  } catch (error) {
    return next(error);
  }
}

async function deleteAnnouncement(req, res, next) {
  try {
    const [result] = await pool.execute('DELETE FROM announcements WHERE id = ?', [Number(req.params.id)]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Announcement was not found.' });
    }

    return res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement
};
