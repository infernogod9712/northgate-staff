const { ratingCommand } = require('../handlers/ratingcommand');

// /setactivityrating [user] [stars] [department]
// Sets the Activity star rating on the roster. See handlers/ratingcommand.js.
module.exports = ratingCommand({ name: 'setactivityrating', field: 'activity', label: 'Activity' });
