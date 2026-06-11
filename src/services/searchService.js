const pool = require('../utils/db');
const { toPublicPath } = require('./fileService');

function getSearchTerms(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2 && !['what', 'the', 'and', 'for', 'this', 'that', 'with'].includes(term));
}

function scoreMatch(match, terms) {
  const content = match.content.toLowerCase();
  const firstLines = content.split('\n').slice(0, 8).join(' ');
  const termHits = terms.filter((term) => content.includes(term)).length;
  const headingHits = terms.filter((term) => firstLines.includes(term)).length;
  const tocPenalty = /contents|\.{5,}| \d+-\d+/.test(firstLines) ? 5 : 0;

  return (headingHits * 5) + termHits - tocPenalty;
}

async function searchDocuments(question) {
  const likeQuery = `%${question}%`;
  const terms = getSearchTerms(question);

  const [matches] = await pool.execute(
    `SELECT dt.document_id, dt.page_number, dt.content, d.title
     FROM document_text dt
     JOIN documents d ON d.id = dt.document_id
     WHERE MATCH(dt.content) AGAINST (? IN NATURAL LANGUAGE MODE)
        OR dt.content LIKE ?
     LIMIT 25`,
    [question, likeQuery]
  );

  if (matches.length > 0) {
    const rankedMatches = matches
      .map((match) => ({
        ...match,
        score: scoreMatch(match, terms)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const imageConditions = rankedMatches
      .map(() => '(di.document_id = ? AND di.page_number = ?)')
      .join(' OR ');
    const imageParams = rankedMatches.flatMap((match) => [match.document_id, match.page_number]);
    const [pageImages] = imageConditions
      ? await pool.execute(
        `SELECT di.document_id, di.page_number, di.image_path, d.title
         FROM document_images di
         JOIN documents d ON d.id = di.document_id
         WHERE ${imageConditions}`,
        imageParams
      )
      : [[]];

    return {
      answer: rankedMatches
        .map((match) => `${match.title}, page ${match.page_number}: ${match.content.slice(0, 700)}`)
        .join('\n\n'),
      images: pageImages.map((image) => ({
        documentId: image.document_id,
        title: image.title,
        pageNumber: image.page_number,
        url: `/${toPublicPath(image.image_path)}`
      })),
      sources: rankedMatches.map((match) => ({
        documentId: match.document_id,
        title: match.title,
        pageNumber: match.page_number
      }))
    };
  }

  const [images] = await pool.execute(
    `SELECT di.document_id, di.page_number, di.image_path, d.title
     FROM document_images di
     JOIN documents d ON d.id = di.document_id
     ORDER BY di.created_at DESC
     LIMIT 6`
  );

  return {
    answer: 'No exact text answer was found. Here are related document images you can review.',
    images: images.map((image) => ({
      documentId: image.document_id,
      title: image.title,
      pageNumber: image.page_number,
      url: `/${toPublicPath(image.image_path)}`
    })),
    sources: []
  };
}

module.exports = {
  searchDocuments
};
