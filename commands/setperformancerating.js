const { ratingCommand } = require('../handlers/ratingcommand');

// /setperformancerating [user] [stars] [department]
// Sets the Performance star rating on the roster. See handlers/ratingcommand.js.
module.exports = ratingCommand({ name: 'setperformancerating', field: 'performance', label: 'Performance' });
