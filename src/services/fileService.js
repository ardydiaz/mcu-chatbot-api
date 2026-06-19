const path = require('path');
const { imageDir, uploadDir } = require('../config/env');

function toPublicPath(filePath) {
  const normalizedPath = path.resolve(filePath);
  const normalizedUploadDir = path.resolve(uploadDir);
  const normalizedImageDir = path.resolve(imageDir);

  if (normalizedPath.startsWith(normalizedUploadDir)) {
    return path.posix.join(
      'storage/uploads',
      path.relative(normalizedUploadDir, normalizedPath).split(path.sep).join('/')
    );
  }

  if (normalizedPath.startsWith(normalizedImageDir)) {
    return path.posix.join(
      'storage/images',
      path.relative(normalizedImageDir, normalizedPath).split(path.sep).join('/')
    );
  }

  return filePath.split(path.sep).join('/');
}

module.exports = {
  toPublicPath
};
