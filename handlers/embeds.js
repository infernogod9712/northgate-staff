const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

// One shared palette so every embed the bot sends reads as one system.
const COLORS = {
  promote: 0x2ecc71, // green   - promotions, approvals
  infract: 0xe74c3c, // red     - infractions, denials, reports
  info:    0x5865f2, // blurple - panels and notices
};

function withFooter(embed, text, iconURL) {
  return embed.setFooter(iconURL ? { text, iconURL } : { text }).setTimestamp();
}

// ── Staff actions ─────────────────────────────────────────────────────────────
function promotionEmbed(target, rank, reason, issuer) {
  return withFooter(new EmbedBuilder()
    .setColor(COLORS.promote)
    .setTitle('Staff Promotion')
    .setDescription('The staff leadership team has decided to grant you a promotion. Congratulations!')
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'Staff Member', value: `<@${target.id}>`, inline: true },
      { name: 'New Rank', value: `<@&${rank.id}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ),
    `Promotion issued by ${issuer.username}`, issuer.displayAvatarURL());
}

// One template for every infraction type. Only Type + Reason change, plus an
// optional note for the types that also take an action (a kick, for example).
function infractionEmbed(target, type, reason, issuer, note) {
  const e = new EmbedBuilder()
    .setColor(COLORS.infract)
    .setTitle('Staff Infraction')
    .setDescription('The staff leadership team has issued you an infraction. Please review the details below.')
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'Staff Member', value: `<@${target.id}>`, inline: true },
      { name: 'Type', value: type, inline: true },
      { name: 'Reason', value: reason, inline: false },
    );
  if (note) e.addFields({ name: 'Note', value: note, inline: false });
  return withFooter(e, `Infraction issued by ${issuer.username}`, issuer.displayAvatarURL());
}

// ── Staff reports ──────────────────────────────────────────────────────────
// The panel that sits in the staff-report channel. One button opens the form.
function reportBoxEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Staff Reports')
    .setDescription([
      'Have a problem with a member of staff? Press the button below to file a report with the HR department.',
      '',
      'Reports are **not anonymous**. Your name is attached so HR can follow up with you, and only the HR department can read them.',
    ].join('\n'));
}

function reportBoxRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('report_open')
      .setLabel('File a Report')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
  );
}

// The record posted into the HR forum. Unlike the ARC-32 complaint version this
// names the reporter, so HR can follow up with them.
function reportLogEmbed(f, reporter) {
  return withFooter(new EmbedBuilder()
    .setColor(COLORS.infract)
    .setTitle('Staff Report')
    .setThumbnail(reporter.displayAvatarURL())
    .addFields(
      { name: 'Reported By', value: `<@${reporter.id}> (${reporter.username})`, inline: false },
      { name: 'Staff Member', value: f.staff.slice(0, 1024), inline: false },
      { name: 'Report', value: f.details.slice(0, 1024), inline: false },
    ),
    `Filed by ${reporter.username}`, reporter.displayAvatarURL());
}

module.exports = {
  COLORS, withFooter,
  promotionEmbed, infractionEmbed,
  reportBoxEmbed, reportBoxRow, reportLogEmbed,
};
