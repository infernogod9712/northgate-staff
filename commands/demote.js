const { rankCommand } = require('../handlers/rankcommand');

// /demote [user] [sheet_rank] [previous_rank] [new_rank] [reason] [department]
// Sets their title in the Roles column of the roster, takes away previous_rank,
// gives them new_rank, logs it to the hub's infraction channel, and DMs them.
// Built in handlers/rankcommand.js, which /promote shares.
module.exports = rankCommand('demote');
