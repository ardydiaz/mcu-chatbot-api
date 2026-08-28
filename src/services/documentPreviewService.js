const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { officeConverterCommand, previewDir } = require('../config/env');

const previewableOriginalExtensions = new Set(['.pdf', '.txt']);
const convertibleExtensions = new Set(['.doc', '.docx']);

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function getConverterCandidates() {
  return [
    officeConverterCommand,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ].filter(Boolean);
}

async function convertOfficeDocumentToPdf(filePath, documentId) {
  fs.mkdirSync(previewDir, { recursive: true });

  const outputPath = path.join(previewDir, `document-${documentId}.pdf`);

  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  const expectedConvertedPath = path.join(
    previewDir,
    `${path.basename(filePath, path.extname(filePath))}.pdf`
  );
  let lastError = null;

  for (const command of getConverterCandidates()) {
    try {
      await execFileAsync(
        command,
        ['--headless', '--convert-to', 'pdf', '--outdir', previewDir, filePath],
        { timeout: 120000, windowsHide: true }
      );

      if (fs.existsSync(expectedConvertedPath)) {
        fs.renameSync(expectedConvertedPath, outputPath);
      }

      if (fs.existsSync(outputPath)) {
        return outputPath;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(
    'Unable to generate document preview. Install LibreOffice or set OFFICE_CONVERTER_COMMAND.'
  );
  error.cause = lastError;
  throw error;
}

async function ensureDocumentPreview({ documentId, filePath }) {
  const extension = path.extname(filePath).toLowerCase();

  if (previewableOriginalExtensions.has(extension)) {
    return {
      previewFilePath: filePath,
      previewType: extension.replace('.', ''),
      generated: false
    };
  }

  if (!convertibleExtensions.has(extension)) {
    return {
      previewFilePath: '',
      previewType: '',
      generated: false
    };
  }

  const previewFilePath = await convertOfficeDocumentToPdf(filePath, documentId);

  return {
    previewFilePath,
    previewType: 'pdf',
    generated: true
  };
}

module.exports = {
  ensureDocumentPreview
};
