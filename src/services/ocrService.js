const { execFile } = require('child_process');
const { promisify } = require('util');
const { ocrCommand, ocrEnabled, ocrLanguage } = require('../config/env');

const execFileAsync = promisify(execFile);

function cleanOcrText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractTextFromImage(imagePath) {
  if (!ocrEnabled) {
    return '';
  }

  try {
    const { stdout } = await execFileAsync(
      ocrCommand,
      [imagePath, 'stdout', '-l', ocrLanguage],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 4
      }
    );

    return cleanOcrText(stdout);
  } catch (error) {
    console.warn(`OCR skipped for ${imagePath}: ${error.message}`);
    return '';
  }
}

module.exports = {
  extractTextFromImage
};
