var express = require('express');
var async = require('async');
var _ = require('lodash');
var ensure = require('../middleware/ensure');
var whois = require('../whois');
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
  router.post('/request', [hasRole('admin'), validateDomainName, ensure.domainManager], function(req, res, next) {
    var domainName = req.body.domain;
    debug('add custom domain %s to org %s', domainName, req.ext.organization.orgId);

    var domainData = req.body;
    domainData.orgId = req.ext.organization.orgId;

    var topLevelDomain = domainName.split('.').slice(-2).join('.');

    async.waterfall([
      function(cb) {
        var certificateId = domainData.certificate;
        // If no certificateId was specified, provision a new wildcard certificate
        if (_.isEmpty(certificateId)) {
          createCertificate(req, topLevelDomain, cb);
        } else {
          loadCertificate(req, certificateId, topLevelDomain, cb);
        }
      },
      function(certificate, cb) {
        req.app.settings.database.createDomain({
          orgId: req.ext.organization.orgId,
          domain: domainName,
          certificate: certificate.certificateId,
          zone: certificate.zone
        }, cb);
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

  // Final confirmation for a domain.
  // router.post('/confirm', function(req, res, next) {
  //   var domainName = req.body.domainName;
  //
  //   // Lookup the domain.
  // });

  // Delete a custom domain
  router.delete('/', [ensure.domainManager, hasRole('admin')], function(req, res, next) {
    if (!req.app.settings.domains) {
      return next(new Error('No domain registrar configured on the 4front application'));
    }

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
        if (!domainToDelete.certificate) return cb();

        // Get the zone from the certificate to be sure we have the right one.
        req.app.settings.database.getCertificate(domainToDelete.certificate, function(err, cert) {
          if (err) return cb(err);
          domainToDelete.zone = cert.zone;
          cb();
        });
      },
      function(cb) {
        req.app.settings.domains.unregister(domainName, domainToDelete.zone, cb);
      },
      function(cb) {
        req.app.settings.database.deleteDomain(req.ext.organization.orgId, domainName, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  // Check the availability of the domain name. If it is available,
  // return whois information for the domain.
  router.get('/check', validateDomainName, function(req, res, next) {
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

function createCertificate(req, topLevelDomain, callback) {
  async.waterfall([
    function(cb) {
      req.app.settings.domains.requestWildcardCertificate(topLevelDomain, cb);
    },
    function(certId, cb) {
      req.app.settings.database.createCertificate({
        certificateId: certId,
        orgId: req.ext.organization.orgId,
        commonName: '*.' + topLevelDomain,
        altNames: [topLevelDomain],
        name: topLevelDomain,
        status: 'Pending'
      }, cb);
    }
  ], callback);
}

function loadCertificate(req, certificateId, topLevelDomain, callback) {
  // If a certificateId was provided, make sure it is a valid cert for this account.
  // If a certificate was specified, make sure it is a valid cert name
  // and set the zone of the domain to match the zone of the cert.
  req.app.settings.database.getCertificate(certificateId, function(err, cert) {
    if (err) return callback(err);
    if (!cert) return callback(Error.http(400, 'Invalid certificate ' + certificateId));

    // Make sure the certificate is a wildcard that matches the topLevelDomain
    if (cert.commonName !== '*.' + topLevelDomain) {
      return callback(Error.http(400, 'The certificate name must be a wildcard for *.' + topLevelDomain,
        {code: 'misMatchedCertificate'}));
    }

    callback(null, cert);
  });
}

function validateDomainName(req, res, next) {
  var domainName = req.query.domain || req.body.domain;
  var isValid;
  if (_.isEmpty(domainName) || /^[a-z\-0-9_\.]+$/.test(domainName) === false) {
    isValid = false;
  } else if (domainName.split('.').length !== 3) {
    isValid = false;
  } else {
    isValid = true;
  }

  if (!isValid) {
    return next(Error.http(400, 'Invalid domain name', {code: 'invalidDomainName'}));
  }
  next();
}
