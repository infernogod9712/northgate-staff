const { rankCommand } = require('../handlers/rankcommand');

// /promote [user] [sheet_rank] [previous_rank] [new_rank] [reason] [department]
// Sets their title in the Roles column of the roster, takes away previous_rank,
// gives them new_rank, logs it to the hub's promotion channel, and DMs them.
// Built in handlers/rankcommand.js, which /demote shares.
module.exports = rankCommand('promote');
