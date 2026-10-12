/** Kélita Produção — Tailwind compilado (substitui o CDN de desenvolvimento). */
const path = require('path');
module.exports = {
  content: [path.join(__dirname, '../public/index.html'), path.join(__dirname, '../public/assets/*.js')],
  theme: { extend: {} },
  plugins: [],
};
