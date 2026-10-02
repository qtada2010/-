'use strict';

const { EmbedBuilder } = require('discord.js');

const PERIODS = Object.freeze({
  total: { column: 'total_xp', label: 'الإجمالي' },
  daily: { column: 'daily_xp', label: 'اليومي' },
  weekly: { column: 'weekly_xp', label: 'الأسبوعي' },
  monthly: { column: 'monthly_xp', label: 'الشهري' }
});

async function fetchXpLeaderboard(pool, periodKey = 'total', archiveLabel = null) {
  const period = PERIODS[periodKey] || PERIODS.total;
  if (periodKey !== 'total' && archiveLabel) {
    const archived = await pool.query(`
      SELECT user_id, xp_amount AS xp FROM xp_archive
      WHERE period_type = $1 AND period_label = $2
      ORDER BY rank ASC, user_id ASC;
    `, [periodKey, String(archiveLabel).trim().slice(0, 30)]);
    return { rows: archived.rows, period, periodKey, archiveLabel: String(archiveLabel).trim().slice(0, 30) };
  }

  const result = await pool.query(`
    SELECT user_id, ${period.column} AS xp FROM xp_users
    WHERE ${period.column} > 0
    ORDER BY ${period.column} DESC, user_id ASC;
  `);
  return { rows: result.rows, period, periodKey, archiveLabel: null };
}

function buildXpLeaderboardEmbed(data, page, totalPages, pageSize = 10) {
  const start = page * pageSize;
  const pageRows = data.rows.slice(start, start + pageSize);
  const medals = ['🥇', '🥈', '🥉'];
  const description = pageRows.map((row, index) => {
    const rank = start + index + 1;
    const position = medals[rank - 1] || `**${rank}.**`;
    return `${position} <@${row.user_id}> — **${Number(row.xp || 0).toLocaleString()} XP**`;
  }).join('\n');
  const archiveSuffix = data.archiveLabel ? ` · أرشيف ${data.archiveLabel}` : '';
  return new EmbedBuilder()
    .setColor(0x7964a8)
    .setTitle(`🏆 توب الإكسبي — ${data.period.label}${archiveSuffix}`)
    .setDescription(description || 'لا توجد بيانات لهذه الفترة.')
    .setFooter({ text: `صفحة ${page + 1} من ${Math.max(totalPages, 1)} · إجمالي الأعضاء: ${data.rows.length}` });
}

module.exports = { PERIODS, fetchXpLeaderboard, buildXpLeaderboardEmbed };
