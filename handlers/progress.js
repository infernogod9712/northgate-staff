// progress.js
// The NorthGate house style, copied from NorthGate OS (utils/progress-embed.js)
// so every NorthGate bot looks the same:
//
//   - short replies are one line of text that starts with an emoji
//     (say.error / say.ok / say.info / say.warn)
//   - anything with more than one step is a live checklist embed: blue while it
//     runs, green when it finishes, red where it stops, "Step 2 of 4" in the footer
//
// Keep this file in step with NorthGate OS's progress-embed.js. If the look
// changes there, change it here and in Frontier OS too.

const { EmbedBuilder } = require('discord.js');

const COLORS = {
  info: 0x3498db, // blue  - running, panels, information
  ok: 0x2ecc71, // green - finished, approvals
  error: 0xe74c3c, // red   - failures, infractions
  warn: 0xf59e0b, // amber - "are you sure?"
};

const say = {
  error: (text) => `❌ ${text}`,
  ok: (text) => `✅ ${text}`,
  info: (text) => `ℹ️ ${text}`,
  warn: (text) => `⚠️ ${text}`,
};

// Thrown inside a step to stop with a message the person can act on. Any other
// error stops with "Check the bot logs".
class ProgressFailure extends Error {}

function createProgressTracker({ title, steps, send, edit }) {
  const completedSteps = new Set();
  const warningSteps = new Set();
  let activeStep = null;
  let failedStep = null;
  let failureMessage = null;
  let completionMessage = null;
  let notice = null;

  function buildEmbed() {
    const lines = steps.map((step, index) => {
      if (index === failedStep) return `❌ ${step}`;
      if (warningSteps.has(index)) return `⚠️ ${step}`;
      if (completedSteps.has(index)) return `✅ ${step}`;
      if (index === activeStep) return `🔄 ${step}`;
      return `⏳ ${step}`;
    });
    const description = [completionMessage, failureMessage, notice, lines.join('\n')]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4096);

    return new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setColor(failedStep !== null ? COLORS.error : completionMessage ? COLORS.ok : COLORS.info)
      .setDescription(description)
      .setFooter({
        text: failedStep !== null
          ? `Stopped at step ${failedStep + 1} of ${steps.length}`
          : completionMessage
            ? `Completed ${steps.length} of ${steps.length} steps`
            : `Step ${activeStep === null ? 0 : activeStep + 1} of ${steps.length}`,
      })
      .setTimestamp();
  }

  const refresh = () => edit({ content: '', embeds: [buildEmbed()], allowedMentions: { parse: [] } });

  return {
    async start() {
      await send({ content: '', embeds: [buildEmbed()], allowedMentions: { parse: [] } });
    },

    async runStep(index, operation) {
      if (index !== completedSteps.size || index < 0 || index >= steps.length) {
        throw new Error(`Invalid progress step ${index} for "${title}".`);
      }
      activeStep = index;
      await refresh();

      let result;
      try {
        result = await operation();
      } catch (error) {
        failedStep = index;
        activeStep = null;
        failureMessage = error instanceof ProgressFailure
          ? say.error(error.message)
          : '❌ This step failed. Check the bot logs for details.';
        await refresh();
        throw error;
      }
      completedSteps.add(index);
      activeStep = null;
      return result;
    },

    // Marks a finished step with a warning: it ran, but not everything worked
    // (a closed DM, a missing log channel). The command still carries on.
    async warnStep(index) {
      if (!completedSteps.has(index) && failedStep !== index) {
        throw new Error(`Cannot warn for unfinished progress step ${index} in "${title}".`);
      }
      warningSteps.add(index);
      await refresh();
    },

    // A step whose operation returns false on a soft failure gets a warning.
    async softStep(index, operation) {
      const result = await this.runStep(index, operation);
      if (result === false) await this.warnStep(index);
      return result;
    },

    async setNotice(message) {
      notice = message;
      await refresh();
    },

    async complete(message) {
      if (completedSteps.size !== steps.length) {
        throw new Error(`Cannot complete "${title}" before all steps finish.`);
      }
      completionMessage = message;
      await refresh();
    },
  };
}

// Every Staff Management command defers privately first, so the checklist is
// always the deferred reply being edited.
function createInteractionProgress(interaction, title, steps) {
  const write = (payload) => interaction.editReply(payload);
  return createProgressTracker({ title, steps, send: write, edit: write });
}

// Runs a command body that uses a checklist. A ProgressFailure has already been
// shown in the checklist, so it is swallowed here; anything else is a real bug
// and goes on to index.js's error handler.
async function withProgress(body) {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ProgressFailure) return undefined;
    throw error;
  }
}

module.exports = { COLORS, say, ProgressFailure, createInteractionProgress, withProgress };
