var _ = require('lodash');
var debug = require('debug')('4front-api:validate-app');
require('simple-errors');

module.exports = function() {
  return function(req, res, next) {
    var appData = req.body;
    if (req.params.appId) {
      appData.appId = req.params.appId;
    }

    if (_.isEmpty(appData.name) === true || /^[a-z0-9\-]{3,50}$/.test(appData.name) === false) {
      debug('app name is invalid');
      return next(Error.http(400, 'App name ' + appData.name + ' is not valid', {
        code: 'invalidAppName'
      }));
    }

    // Check if this app name already exists.
    debug('Checking if appName is available: ' + appData.name);
    req.app.settings.database.getAppName(appData.name, function(err, appName) {
      if (err) return next(err);

      if (appName && appName.appId !== appData.appId) {
        return next(Error.http(400, 'Application name ' + appName.name + ' is not available', {
          code: 'appNameUnavailable'
        }));
      }

      next();
    });
  };
};
