'use strict';

const OFFICIAL_SITE_URL = 'https://on-bot.duckdns.org';

function getDashboardUrl() {
  const configured = process.env.DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL || OFFICIAL_SITE_URL;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported dashboard URL protocol');
    url.search = '';
    url.hash = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/dashboard')) url.pathname = `${pathname}/dashboard`;
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    console.error('رابط لوحة التحكم غير صالح، سيتم استخدام الموقع الرسمي:', error.message);
    return `${OFFICIAL_SITE_URL}/dashboard`;
  }
}

module.exports = getDashboardUrl;
module.exports.OFFICIAL_SITE_URL = OFFICIAL_SITE_URL;
