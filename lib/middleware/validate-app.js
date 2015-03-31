var _ = require('lodash');
var debug = require('debug')('4front-api:validate-app');
require('simple-errors');

module.exports = function(options) {
  return function (req, res, next) {
    req.appData = req.body;
    if (req.params.appId)
      req.appData.appId = req.params.appId;

    if (_.isEmpty(req.appData.name) === true || /^[\w\-]{3,50}$/.test(req.appData.name) === false) {
      debug("app name is invalid");
      return next(Error.http(400, "App name " + req.appData.name + " is not valid", {code: 'invalidAppName'}));
    }

    // Check if this app name already exists.
    debug("Checking if appName is available: " + req.appData.name);
    options.database.getAppName(req.appData.name, function(err, appName) {
      if (err)
        return next(err);

      if (appName && appName.appId !== req.appData.appId) {
        return next(Error.http(400, "Application name " + appName.name + " is not available", {code: "appNameUnavailable"}));
      }

      next();
    });
  };
};
