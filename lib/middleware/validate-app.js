var _ = require('lodash');
var async = require('async');
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

    var db = req.app.settings.database;
    var asyncTasks = [];

    asyncTasks.push(function(cb) {
      // Check if this app name already exists.
      debug('Checking if appName is available: ' + appData.name);
      db.getAppName(appData.name, function(err, appName) {
        if (err) return cb(err);

        if (appName && appName.appId !== appData.appId) {
          return cb(Error.http(400, 'Application name ' + appName.name + ' is not available', {
            code: 'appNameUnavailable'
          }));
        }
        cb();
      });
    });

    if (!_.isEmpty(appData.domainName)) {
      // If the subDomain is empty, then use "@" for the apex domain
      if (_.isEmpty(appData.subDomain)) {
        appData.subDomain = '@';
      }

      // If a domainName is specified, make sure it belongs to the current org.
      asyncTasks.push(function(cb) {
        db.getDomain(appData.domainName, function(err, domain) {
          if (err) return cb(err);
          if (!domain) {
            return cb(Error.http(400, 'Domain ' + appData.domainName + ' not registered', {
              code: 'domainNameNotRegistered'
            }));
          }

          if (domain.orgId !== req.ext.organization.orgId) {
            return cb(Error.http(400, 'Domain does not belong to this organization.', {
              code: 'domainNameForbidden'
            }));
          }
          cb();
        });
      });

      // Make sure the domain/sub-domain is available
      asyncTasks.push(function(cb) {
        // If the subDomain is being updated, make sure there's not another app already using it.
        db.getAppIdByDomainName(appData.domainName, appData.subDomain, function(err, appId) {
          if (err) return cb(err);
          if (!appId) return cb();
          if (_.isEmpty(req.params.appId) || appId !== req.params.appId) {
            return cb(Error.http(400, 'This domain and sub-domain is already in use.', {
              code: appData.subDomain === '@' ? 'apexDomainNotAvailable' : 'subDomainNotAvailable'
            }));
          }
          cb();
        });
      });
    } else if (!_.isUndefined(appData.domainName)) {
      appData.domainName = null;
      appData.subDomain = null;
    }

    async.series(asyncTasks, next);
  };
};
