const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

// Discord requires every text input to sit in its own action row, and a modal
// can hold at most 5 of them.
const row = (input) => new ActionRowBuilder().addComponents(input);

// Staff report form. NOT anonymous: the reporter is taken from the
// interaction itself, so there is no need to ask them who they are.
function buildReportModal() {
  return new ModalBuilder()
    .setCustomId('report_modal')
    .setTitle('Staff Report')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('staff')
        .setLabel('Staff member you are reporting')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)),
      row(new TextInputBuilder()
        .setCustomId('details')
        .setLabel('What is your report about?')
        .setPlaceholder('What happened?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)),
    );
}

function readReportFields(interaction) {
  return {
    staff: interaction.fields.getTextInputValue('staff'),
    details: interaction.fields.getTextInputValue('details'),
  };
}

module.exports = { row, buildReportModal, readReportFields };
