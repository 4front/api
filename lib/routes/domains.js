var express = require('express');
var async = require('async');
var _ = require('lodash');
var debug = require('debug')('4front:api:domains');

module.exports = function() {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // Create a new custom domain
  router.put('/', hasRole('admin'), function(req, res, next) {
    if (!req.app.settings.domains) {
      return next(new Error('No domain registrar configured on the 4front application'));
    }

    var domainName = req.body.domain;
    debug('add custom domain %s to org %s', domainName, req.ext.organization.orgId);

    // Validate the CNAME
    if (_.isEmpty(domainName) || /^[a-z-0-9_\.]+$/.test(domainName) === false) {
      return next(Error.http(400, 'Invalid domain name', {code: 'invalidDomainName'}));
    }

    var domainData = req.body;
    domainData.orgId = req.ext.organization.orgId;

    async.waterfall([
      function(cb) {
        req.app.settings.domains.register(domainName, cb);
      },
      function(zoneId, cb) {
        domainData.zoneId = zoneId;
        req.app.settings.database.createDomain(domainData, cb);
      }
    ], function(err, domain) {
      if (err) return next(err);

      res.json(domain);
    });
  });

  // Delete a custom domain
  router.delete('/', hasRole('admin'), function(req, res, next) {
    if (!req.app.settings.domains) {
      return next(new Error('No domain registrar configured on the 4front application'));
    }

    var domainName = req.body.domain;

    async.waterfall([
      function(cb) {
        req.app.settings.database.getDomain(domainName, function(err, domain) {
          if (err) return cb(err);

          if (!domain) {
            debug('domain %s not found', domainName);
            return cb(Error.http(404, 'Domain ' + domainName + ' not found', {
              code: 'domainNotFound'
            }));
          }

          if (domain.orgId !== req.ext.organization.orgId) {
            return cb(Error.http(403, 'Cannot delete domain %s that does not belong to this org', domain.orgId));
          }

          cb(null, domain);
        });
      },
      function(domain, cb) {
        if (req.app.settings.domains) {
          req.app.settings.domains.unregister(domainName, domain.zone, function(err) {
            cb(err, domain);
          });
        } else {
          cb(null, domain);
        }
      },
      function(domain, cb) {
        req.app.settings.database.deleteDomain(req.ext.organization.orgId, domainName, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  return router;
};
