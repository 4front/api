var express = require('express');
var async = require('async');
var _ = require('lodash');
var ensure = require('../middleware/ensure');
var debug = require('debug')('4front:api:domains');

module.exports = function() {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // List the domains for the organization
  router.get('/', function(req, res, next) {
    req.app.settings.database.listDomains(req.ext.organization.orgId, function(err, domains) {
      if (err) return next(err);

      res.json(domains);
    });
  });

  // Create a new custom domain
  router.post('/', [hasRole('admin'), ensure.domainManager], function(req, res, next) {
    var domainName = req.body.domain;
    debug('add custom domain %s to org %s', domainName, req.ext.organization.orgId);

    // Validate the CNAME
    if (_.isEmpty(domainName) || /^[a-z\-0-9_\.]+$/.test(domainName) === false) {
      return next(Error.http(400, 'Invalid domain name', {code: 'invalidDomainName'}));
    }

    var domainData = req.body;
    domainData.orgId = req.ext.organization.orgId;

    async.waterfall([
      function(cb) {
        req.app.settings.domains.register(domainName, cb);
      },
      function(zoneId, cb) {
        domainData.zone = zoneId;
        req.app.settings.database.createDomain(domainData, cb);
      }
    ], function(err, domain) {
      if (err) return next(err);

      res.json(domain);
    });
  });

  // Update a domain
  router.put('/', [hasRole('admin'), ensure.domainManager], function(req, res, next) {
    var domainData = req.body;

    domainData.orgId = req.ext.organization.orgId;
    var existingDomain;
    var updatedDomain;

    async.series([
      function(cb) {
        req.app.settings.database.getDomain(domainData.domain, function(err, domain) {
          if (err) return cb(err);
          existingDomain = domain;
          cb();
        });
      },
      function(cb) {
        if (!domainData.certificate) {
          // If the domain was previously in a certificate zone, explicitly set
          // the zone to null so it will get transferred to a shared non-SSL zone.
          // Otherwise if the domain previously was not in a certificate zone,
          // just leave the zone as-is.
          if (existingDomain.certificate) {
            domainData.zone = null;
          } else {
            domainData.zone = existingDomain.zone;
          }
          return cb();
        }

        // If a certificate was specified, get the zone of the cert
        req.app.settings.database.getCertificate(domainData.certificate, function(err, cert) {
          if (err) return cb(err);
          if (!cert) return cb(new Error('Invalid certificate ' + domainData.certificate));

          domainData.zone = cert.zone;
          cb();
        });
      },
      function(cb) {
        // If the zone of the domain has changed, need to transfer it with the domain manager.
        if (domainData.zone !== existingDomain.zone) {
          var domainName = existingDomain.domain;
          var currentZone = existingDomain.zone;
          var targetZone = domainData.zone;

          req.app.settings.domains.transferDomain(domainName, currentZone, targetZone, function(err, newZone) {
            if (err) return cb(err);
            domainData.zone = newZone;
            cb();
          });
        } else {
          cb();
        }
      },
      function(cb) {
        // Update the domain in the database.
        // Ensure we explicitly set the certificate to null if it's missing so
        // it gets erased in the database.
        if (!domainData.certificate) domainData.certificate = null;

        req.app.settings.database.updateDomain(domainData, function(err, domain) {
          if (err) return cb(err);
          updatedDomain = domain;
          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      res.json(updatedDomain);
    });
  });

  // Delete a custom domain
  router.delete('/', [ensure.domainManager, hasRole('admin')], function(req, res, next) {
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
