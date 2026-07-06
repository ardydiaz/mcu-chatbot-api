const pool = require('../utils/db');

function mapAnnouncement(row) {
  return {
    id: row.id,
    siteScope: row.site_scope,
    title: row.title,
    body: row.body,
    priority: row.priority,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isAnnouncementQuestion(message) {
  const normalized = String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /\b(announcement|announcements|announce|news|updates|new today|what s new|whats new|what is new|latest|today)\b/.test(normalized);
}

async function listActiveAnnouncements(scope) {
  const scopes = scope === 'general' ? ['general'] : [scope, 'general'];
  const placeholders = scopes.map(() => '?').join(', ');
  let rows = [];

  try {
    [rows] = await pool.execute(
      `SELECT id, site_scope, title, body, priority, start_date, end_date, is_active, created_at, updated_at
       FROM announcements
       WHERE is_active = 1
         AND site_scope IN (${placeholders})
         AND (start_date IS NULL OR start_date <= CURDATE())
         AND (end_date IS NULL OR end_date >= CURDATE())
       ORDER BY FIELD(priority, 'urgent', 'important', 'normal'), start_date DESC, created_at DESC
       LIMIT 8`,
      scopes
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }

    throw error;
  }

  return rows.map(mapAnnouncement);
}

function buildAnnouncementReply(announcements) {
  if (announcements.length === 0) {
    const answer = 'There are no active university announcements for today.';

    return {
      answer,
      answerBlocks: [{ type: 'p', text: answer }],
      answerMode: 'announcements',
      images: [],
      sources: []
    };
  }

  const intro = announcements.length === 1
    ? 'Here is the active university announcement for today.'
    : 'Here are the active university announcements for today.';
  const answer = [
    intro,
    '',
    ...announcements.map((announcement, index) => `${index + 1}. ${announcement.title} - ${announcement.body}`)
  ].join('\n');

  return {
    answer,
    answerBlocks: [
      { type: 'p', text: intro },
      {
        type: 'ol',
        items: announcements.map((announcement) => ({
          value: `${announcement.title} - ${announcement.body}`,
          meta: announcement.priority
        }))
      }
    ],
    answerMode: 'announcements',
    images: [],
    sources: announcements.map((announcement) => ({
      title: 'University Announcement',
      pageLabel: announcement.title,
      pageNumber: announcement.id
    }))
  };
}

async function getAnnouncementReply(message, scope) {
  if (!isAnnouncementQuestion(message)) {
    return null;
  }

  return buildAnnouncementReply(await listActiveAnnouncements(scope));
}

module.exports = {
  getAnnouncementReply,
  isAnnouncementQuestion,
  listActiveAnnouncements,
  mapAnnouncement
};
