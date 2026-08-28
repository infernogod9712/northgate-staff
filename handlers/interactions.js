// Every button click and form (modal) submit lands here, so index.js stays a thin
// router and new interactions only ever get added in one place.
//
// A customId is the string set on a button or modal when it is built. Split it on
// '_' to carry data through the click.
const { MessageFlags } = require('discord.js');
const { findReportForum } = require('./settings');
const { buildReportModal, readReportFields } = require('./forms');
const { reportLogEmbed } = require('./embeds');

async function handleButton(interaction) {
  if (interaction.customId === 'report_open') {
    await interaction.showModal(buildReportModal());
    return true;
  }
  return false;
}

// A staff report was submitted. The button lives in the main server but the HR
// forum lives in the staff hub, so the forum id is looked up across every guild
// rather than out of this guild's own settings.
async function handleReport(interaction) {
  const fields = readReportFields(interaction);

  const forumId = findReportForum();
  if (!forumId) {
    return interaction.reply({
      content: 'Staff reports are not set up yet. Ask an owner to set report_forum with /config in the staff hub.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const forum = await interaction.client.channels.fetch(forumId).catch(() => null);
  if (!forum) {
    return interaction.reply({
      content: 'The HR report forum could not be found. Ask an owner to check report_forum in /config.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    // Thread titles are capped at 100 characters, so the staff name is trimmed to
    // leave room for the prefix.
    await forum.threads.create({
      name: `Report - ${fields.staff}`.slice(0, 90),
      message: { embeds: [reportLogEmbed(fields, interaction.user)] },
    });
  } catch (err) {
    console.error('[report] could not create the forum post:', err.message);
    return interaction.reply({
      content: 'Could not file your report. Ask an owner to check the bot can post in the HR forum.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: 'Your report has been sent to the HR department. They will follow up with you.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleModal(interaction) {
  if (interaction.customId === 'report_modal') return handleReport(interaction);
  return false;
}

module.exports = { handleButton, handleModal };
