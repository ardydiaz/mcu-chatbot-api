const path = require('path');

function toPublicPath(filePath) {
  return filePath.split(path.sep).join('/');
}

module.exports = {
  toPublicPath
};
