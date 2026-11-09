// register.js
// Registers the slash commands by itself, so nobody has to run anything after a
// deploy. Called on startup for every server the bot is in, and again whenever
// it joins a new one.
//
// They are registered per server, which Discord shows instantly. Global
// commands (what the old !sc made) take up to an hour, and a leftover global
// copy shows up next to the per-server one as a duplicate, so the global list
// is cleared once on startup.

async function registerInGuild(guild, commands) {
  try {
    await guild.commands.set(commands.map((command) => command.data.toJSON()));
    console.log(`[commands] registered ${commands.length} command(s) in ${guild.name}`);
    return true;
  } catch (err) {
    console.error(`[commands] could not register in ${guild.name}:`, err.message);
    return false;
  }
}

async function registerEverywhere(client) {
  const commands = [...client.commands.values()];
  try {
    await client.application.commands.set([]);
  } catch (err) {
    console.warn('[commands] could not clear the old global commands:', err.message);
  }
  for (const guild of client.guilds.cache.values()) await registerInGuild(guild, commands);
}

module.exports = { registerInGuild, registerEverywhere };
