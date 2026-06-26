const {
  ollamaBaseUrl,
  ollamaModel,
  ollamaRequestTimeoutMs,
  ollamaEnabled
} = require('../config/env');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanAnswerText(value) {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJsonResponse(value) {
  const cleanedValue = cleanAnswerText(value);
  const jsonMatch = cleanedValue.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function formatGeneratedAnswer(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const parts = [];
  const answer = cleanAnswerText(data.answer);
  const steps = Array.isArray(data.steps)
    ? data.steps.map(cleanAnswerText).filter(Boolean).slice(0, 8)
    : [];
  const note = cleanAnswerText(data.note);

  if (answer) {
    parts.push(answer);
  }

  if (steps.length > 0) {
    parts.push(steps.map((step, index) => `${index + 1}. ${step}`).join('\n'));
  }

  if (note) {
    parts.push(note);
  }

  return parts.join('\n\n').trim() || null;
}

function formatSummaryAnswer(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  return cleanAnswerText(data.summary);
}

function buildContext(matches) {
  return matches
    .map((match, index) => {
      const content = cleanText(match.content).slice(0, 1800);
      const pageLabel = match.pageLabel || match.printedPageNumber || match.page_number;
      return `Source ${index + 1}: ${match.title}, page ${pageLabel}\n${content}`;
    })
    .join('\n\n');
}

function buildPrompt({ question, matches }) {
  const context = buildContext(matches);

  return [
    'You are MCU Guide, a helpful university chatbot.',
    'Answer the student using only the official university document context below.',
    'If the context does not contain the answer, say that the uploaded documents do not include enough information and suggest the right university office to contact.',
    'Return only valid JSON with this exact shape:',
    '{ "answer": "short direct answer in 1-2 sentences", "steps": ["specific step or key point 1", "specific step or key point 2"], "note": "optional short note or empty string" }',
    'Use the steps array for procedures, requirements, key actions, dates, fees, rules, or lists.',
    'Include 4-8 specific steps or key points when the context contains enough detail.',
    'Do not merge several document actions into one vague item; preserve exact button names, field names, statuses, offices, dates, and requirements from the context.',
    'If the context includes a LIST section or continuation page, include those actions too.',
    'Prefer concrete action wording from the context over broad summaries.',
    'Do not include source text in the answer, steps, or note because the app displays sources separately.',
    '- Do not include hidden reasoning, analysis, or <think> tags.',
    'Keep the answer clear, concise, and student-friendly.',
    'Do not invent policies, fees, dates, names, or requirements.',
    '',
    `Student question: ${question}`,
    '',
    'Official document context:',
    context
  ].join('\n');
}

function buildOfficialSummaryPrompt({ question, officialText }) {
  return [
    'You are MCU Guide, a helpful university chatbot.',
    'Create a short student-friendly summary using only the official text below.',
    'Do not add new policies, warnings, requirements, permissions, offices, or details that are not present in the official text.',
    'Return only valid JSON with this exact shape:',
    '{ "summary": "2-3 sentence summary of the official text" }',
    '',
    `Student question: ${question}`,
    '',
    'Official text:',
    officialText
  ].join('\n');
}

async function generateAnswerWithOllama({ question, matches }) {
  if (!ollamaEnabled || matches.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaRequestTimeoutMs);

  try {
    const response = await fetch(new URL('/api/generate', ollamaBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: buildPrompt({ question, matches }),
        stream: false,
        format: 'json',
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_predict: 900
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama responded with status ${response.status}.`);
    }

    const data = await response.json();
    return formatGeneratedAnswer(parseJsonResponse(data.response)) || cleanAnswerText(data.response);
  } catch (error) {
    console.warn(`Ollama answer generation failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateOfficialTextSummaryWithOllama({ question, officialText }) {
  if (!ollamaEnabled || !officialText) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaRequestTimeoutMs);

  try {
    const response = await fetch(new URL('/api/generate', ollamaBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: buildOfficialSummaryPrompt({ question, officialText }),
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          top_p: 0.8,
          num_predict: 220
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama responded with status ${response.status}.`);
    }

    const data = await response.json();
    return formatSummaryAnswer(parseJsonResponse(data.response));
  } catch (error) {
    console.warn(`Ollama official-text summary failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateAnswerWithOllama,
  generateOfficialTextSummaryWithOllama
};
