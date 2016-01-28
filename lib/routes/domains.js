var express = require('express');
var async = require('async');
var _ = require('lodash');
var ensure = require('../middleware/ensure');
var whois = require('../whois');
var domainHelper = require('../domain-helper');
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

  // Request a new custom domain
  router.post('/request', [hasRole('admin'), domainHelper.validateDomainName, ensure.domainManager], function(req, res, next) {
    var domainName = req.body.domain;
    debug('add custom domain %s to org %s', domainName, req.ext.organization.orgId);

    var domainData = req.body;
    domainData.orgId = req.ext.organization.orgId;

    var topLevelDomain = domainName.split('.').slice(-2).join('.');

    async.waterfall([
      function(cb) {
        var certificateId = domainData.certificateId;
        // If no certificateId was specified, provision a new wildcard certificate
        if (_.isEmpty(certificateId)) {
          domainHelper.createCertificate(req, topLevelDomain, cb);
        } else {
          domainHelper.loadCertificate(req, certificateId, topLevelDomain, cb);
        }
      },
      function(certificate, cb) {
        req.app.settings.database.createDomain({
          orgId: req.ext.organization.orgId,
          domain: domainName,
          certificateId: certificate.certificateId,
          zone: certificate.zone
        }, function(err, domain) {
          if (err) return cb(err);
          cb(null, certificate, domain);
        });
      }
    ], function(err, certificate, domain) {
      if (err) return next(err);

      res.json({domain: domain, certificate: certificate});
    });
  });

  // Final confirmation for a domain.
  // router.post('/confirm', function(req, res, next) {
  //   var domainName = req.body.domainName;
  //
  //   // Lookup the domain.
  // });

  // Delete a custom domain
  router.delete('/', [ensure.domainManager, hasRole('admin')], function(req, res, next) {
    var domainName = req.body.domain;
    var domainToDelete;

    async.series([
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
          domainToDelete = domain;

          cb();
        });
      },
      function(cb) {
        domainHelper.deleteDomain(req, domainToDelete, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  // Check the availability of the domain name. If it is available,
  // return whois information for the domain.
  router.get('/check', domainHelper.validateDomainName, function(req, res, next) {
    var domainName = req.query.domain;

    var domainCheck = {};
    async.series([
      function(cb) {
        req.app.settings.database.getDomain(domainName, function(err, domain) {
          if (err) return cb(err);
          domainCheck.available = !domain;
          cb();
        });
      },
      function(cb) {
        // Now that we know the domain is available, do a whois lookup to get the list of emails on the record.
        // For the whois lookup, we just want the top level domain.
        var topLevelDomain = domainName.substr(domainName.indexOf('.') + 1);
        whois(topLevelDomain, function(err, record) {
          if (err) return cb(err);

          if (!record) {
            return cb(Error.http(400, 'No WHOIS record for ' + topLevelDomain, {code: 'noWhoisRecord'}));
          }

          _.extend(domainCheck, record);
          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);
      res.json(domainCheck);
    });
  });

  return router;
};
