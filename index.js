const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const { handleButton, handleModal } = require('./handlers/interactions');
const { startAutoSync } = require('./git-sync');
const { startHrPanel } = require('./handlers/hrpanel');
const { startLeaveChecks } = require('./handlers/leave');
const { startNewHireChecks } = require('./handlers/newhires');
const { logCommand, formatOptions } = require('./handlers/commandlog');
const { say } = require('./handlers/progress');
const { handleBotMessage, clearPendingHire } = require('./handlers/botcomms');
const { registerEverywhere, registerInGuild } = require('./handlers/register');
const { handleImpersonate } = require('./handlers/impersonate');
const { isPing, replyPing } = require('./handlers/ping');
const { isRestart, forceRestart } = require('./handlers/forcerestart');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for bc!, n!ping and d!impersonate
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

  // No !sc any more: the commands register themselves on every start.
  registerEverywhere(client).catch((e) => console.error('[commands] registration failed:', e.message));

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
  try {
    startNewHireChecks();
  } catch (e) {
    console.error('[newhires] failed to start:', e.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) return void (await handleButton(interaction));
    if (interaction.isModalSubmit()) return void (await handleModal(interaction));

    if (!interaction.isChatInputCommand()) return;

    // Every command works on a server's roles, channels and settings. Discord also
    // offers global commands in a DM with the bot, where there is no server at all,
    // and every command would crash on it.
    if (!interaction.inGuild()) {
      return void (await interaction.reply({ content: say.error('Use my commands inside the server, not in DMs.'), flags: MessageFlags.Ephemeral }));
    }

    // Logged before it runs, and whether or not the person is allowed to use it.
    // Not awaited: a slow or missing log channel must never delay the command.
    logCommand({
      client,
      guild: interaction.guild,
      channel: interaction.channel,
      user: interaction.user,
      name: interaction.commandName,
      args: formatOptions(interaction.options.data),
    });

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error('[NGS] interaction error:', err);
    const msg = { content: say.error('Something went wrong running that.'), flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

// Messages: bc! commands from the other NorthGate bots, and d!impersonate.
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;

  // Other NorthGate bots talk to this one with bc! messages, such as the ticket
  // bot's bc!hire (handlers/botcomms.js). Anything else a bot says is ignored.
  if (message.author.bot) {
    let handled = null;
    try {
      handled = await handleBotMessage(message);
    } catch (err) {
      console.error('[bc] could not handle a bot message:', err.message);
    }
    if (handled) {
      logCommand({ client, guild: message.guild, channel: message.channel, user: message.author, name: handled.command, type: 'Bot command', args: message.content.trim().split(/\s+/).slice(1) });
    }
    return;
  }

  // d!forcerestart ops: restart this bot (owners only).
  if (isRestart(message.content)) {
    await logCommand({ client, guild: message.guild, channel: message.channel, user: message.author, name: 'd!forcerestart', type: 'Developer command', args: ['ops'] });
    return void (await forceRestart(message));
  }

  // n!ping: every NorthGate bot answers it.
  if (isPing(message.content)) {
    logCommand({ client, guild: message.guild, channel: message.channel, user: message.author, name: 'n!ping', type: 'Prefix command' });
    return void (await replyPing(message).catch((err) => console.error('[ping] failed:', err.message)));
  }

  // d!impersonate: the developer tool every NorthGate bot shares. This bot
  // answers for its own commands only (handlers/impersonate.js).
  let handled = null;
  try {
    handled = await handleImpersonate(message);
  } catch (err) {
    console.error('[impersonate] failed:', err);
    await message.reply(say.error('That check failed. See the bot logs.')).catch(() => {});
    handled = 'd!impersonate';
  }
  if (handled) {
    logCommand({ client, guild: message.guild, channel: message.channel, user: message.author, name: handled, type: 'Impersonation check (nothing was run)', args: message.content.trim().split(/\s+/).slice(1) });
  }
});

// Slash commands register themselves on every server the bot joins.
client.on(Events.GuildCreate, (guild) => registerInGuild(guild, [...client.commands.values()]));

// A ticket that is closed and deleted without a /hire takes its bc!hire details
// with it, so nothing about a person is kept for a ticket that no longer exists.
const forgetTicket = (channel) => {
  try {
    clearPendingHire(channel.id);
  } catch (err) {
    console.error('[bc] could not clear a deleted ticket:', err.message);
  }
};
client.on(Events.ChannelDelete, forgetTicket);
client.on(Events.ThreadDelete, forgetTicket);

client.on('error', (err) => console.error('[NGS] client error:', err));
process.on('unhandledRejection', (err) => console.error('[NGS] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[NGS] UNCAUGHT EXCEPTION:', err));

client.login(config.token);
