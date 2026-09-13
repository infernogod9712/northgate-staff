const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const { handleButton, handleModal } = require('./handlers/interactions');
const { isOwner } = require('./handlers/permissions');
const { startAutoSync } = require('./git-sync');
const { startHrPanel } = require('./handlers/hrpanel');
const { startLeaveChecks } = require('./handlers/leave');
const { logCommand } = require('./handlers/commandlog');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for the !sc chat command
  ],
});

// Load every command file. Each one is wrapped so a single broken file cannot
// stop the whole bot from starting.
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  try {
    const command = require(path.join(commandsPath, file));
    if (command?.data && command?.execute) client.commands.set(command.data.name, command);
    else console.warn(`[NGS] Skipped ${file}: missing data or execute.`);
  } catch (err) {
    console.error(`[NGS] Failed to load ${file}:`, err.message);
  }
}

client.once(Events.ClientReady, () => {
  console.log(`[NGS] Online as ${client.user.tag}`);
  console.log(`[NGS] Loaded ${client.commands.size} command(s) in ${client.guilds.cache.size} server(s)`);

  // On the Pi, watch GitHub and pull new commits automatically. Logs out cleanly
  // first so pm2 restarts the process on the fresh code.
  startAutoSync(config.gitSync || {}, {
    onBeforeRestart: () => client.destroy(),
  }).catch((e) => console.error('[git-sync] failed to start:', e.message));

  // The auto-updating HR panels, and the check that returns people from leave
  // when their end date passes. A problem in either is logged and never takes the
  // rest of the bot down with it.
  try {
    startHrPanel(client);
  } catch (e) {
    console.error('[hrpanel] failed to start:', e.message);
  }
  try {
    startLeaveChecks(client);
  } catch (e) {
    console.error('[leave] failed to start:', e.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) return void (await handleButton(interaction));
    if (interaction.isModalSubmit()) return void (await handleModal(interaction));

    if (!interaction.isChatInputCommand()) return;

    // Logged before it runs, and whether or not the person is allowed to use it.
    // Not awaited: a slow or missing log channel must never delay the command.
    logCommand({
      client,
      guild: interaction.guild,
      channel: interaction.channel,
      user: interaction.user,
      name: interaction.commandName,
    });

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error('[NGS] interaction error:', err);
    const msg = { content: 'Something went wrong running that.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

// !sc (owners only) registers the slash commands globally, so they appear in every
// server the bot is in. Global commands can take up to about an hour to propagate.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (message.content.trim() !== '!sc') return;

  logCommand({
    client,
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    name: 'sc',
    type: 'Prefix command',
  });

  if (!isOwner(message.author.id)) {
    return message.reply('Only the bot owners can sync commands.').catch(() => {});
  }
  try {
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    await client.application.commands.set(data);
    // Wipe leftover per-guild copies or they show up as duplicates next to the
    // global ones.
    let cleared = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.commands.set([]);
        cleared += 1;
      } catch (e) {
        console.warn(`[NGS] could not clear guild commands in ${guild.id}:`, e.message);
      }
    }
    await message.reply(`Synced ${data.length} commands globally and cleared per-guild copies in ${cleared} server(s). Global commands can take up to about an hour to refresh.`);
  } catch (err) {
    console.error('[NGS] sync error:', err);
    await message.reply(`Sync failed: ${err.message}`).catch(() => {});
  }
});

client.on('error', (err) => console.error('[NGS] client error:', err));
process.on('unhandledRejection', (err) => console.error('[NGS] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[NGS] UNCAUGHT EXCEPTION:', err));

client.login(config.token);
