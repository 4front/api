var express = require('express');
var async = require('async');
var _ = require('lodash');
var ensure = require('../middleware/ensure');
var whois = require('../whois');
var publicSuffixList = require('psl');
var debug = require('debug')('4front:api:domains');
require('simple-errors');

module.exports = function() {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // List the legacy domains for the organization
  router.get('/legacy', function(req, res, next) {
    req.app.settings.database.listLegacyDomains(req.ext.organization.orgId, function(err, domains) {
      if (err) return next(err);
      res.json(domains);
    });
  });

  // Delete legacy domain
  router.delete('/legacy', function(req, res, next) {
    var domain;
    async.series([
      function(cb) {
        req.app.settings.database.getLegacyDomain(req.body.domainName, function(err, _domain) {
          if (err) return cb(err);
          domain = _domain;
          cb();
        });
      },
      function(cb) {
        if (_.isEmpty(domain.zone)) return cb();
        req.app.settings.domains.unregisterLegacyDomain(domain.domain, domain.zone, cb);
      },
      function(cb) {
        req.app.settings.database.deleteLegacyDomain(req.body.domainName, cb);
      }
    ], function(err) {
      if (err) return next(err);
      res.status(204).end();
    });
  });

  // List the domains for the organization
  router.get('/', function(req, res, next) {
    var domains;
    async.series([
      function(cb) {
        req.app.settings.database.listDomains(req.ext.organization.orgId, function(err, _domains) {
          if (err) return cb(err);
          domains = _domains;
          cb();
        });
      },
      function(cb) {
        // If any of the domains have a status of InProgress, get an updated status.
        var inProgressDomains = _.filter(domains, {status: 'InProgress'});
        async.each(inProgressDomains, function(domain, nextDomain) {
          debug('get status of domain', domain.domainName);
          req.app.settings.domains.getCdnDistributionStatus(domain.cdnDistributionId, function(err, status) {
            if (err) return nextDomain(err);

            // If the status is no longer 'InProgress', update the value in the database.
            if (status !== 'InProgress') {
              domain.status = status;
              req.app.settings.database.updateDomain({
                domainName: domain.domainName,
                status: status,
                orgId: req.ext.organization.orgId
              }, nextDomain);
            } else {
              nextDomain();
            }
          });
        }, cb);
      },
      // For any domains with status 'Pending', get the latest certificate status.
      function(cb) {
        var pendingDomains = _.filter(domains, {status: 'Pending'});
        async.each(pendingDomains, function(domain, nextDomain) {
          req.app.settings.domains.getCertificateStatus(domain.certificateId, function(err, status) {
            if (err) return nextDomain(err);
            domain.certificateStatus = status;
            nextDomain();
          });
        }, cb);
      }
    ], function(err) {
      if (err) return next(err);
      res.json(domains);
    });
  });

  // Request a new custom domain
  router.post('/request', [hasRole('admin'), validateDomainName, ensure.domainManager], function(req, res, next) {
    var domainName = req.body.domainName;
    debug('request domain %s for org %s', domainName, req.ext.organization.orgId);

    var domainData = req.body;
    domainData.orgId = req.ext.organization.orgId;

    async.waterfall([
      function(cb) {
        req.app.settings.database.getDomain(domainName, function(err, existingDomain) {
          if (err) return cb(err);
          if (existingDomain) {
            return cb(Error.http(400, 'Domain ' + domainName + ' is already taken',
              {log: false, code: 'domainNotAvailable'}));
          }
          cb();
        });
      },
      function(cb) {
        req.app.settings.domains.requestWildcardCertificate(domainName, cb);
      },
      function(certificateId, cb) {
        req.app.settings.database.createDomain({
          orgId: req.ext.organization.orgId,
          domainName: domainName,
          certificateId: certificateId,
          status: 'Pending'
        }, cb);
      }
    ], function(err, domain) {
      if (err) return next(err);

      res.json(domain);
    });
  });

  // Final confirmation for a domain.
  router.post('/confirm', function(req, res, next) {
    var domainName = req.body.domainName;
    var domain;
    var cdnDistribution;

    async.series([
      function(cb) {
        ensureDomainExists(req, domainName, function(err, _domain) {
          if (err) return cb(err);
          domain = _domain;
          cb();
        });
      },
      function(cb) {
        req.app.settings.domains.getCertificateStatus(domain.certificateId, function(err, status) {
          if (err) return cb(err);
          if (status === 'PENDING_VALIDATION') {
            return cb(Error.create('Certificate is still pending validation', {code: 'certNotApproved', log: false}));
          } else if (status === 'VALIDATION_TIMED_OUT') {
            return cb(Error.create('Certificate is still pending validation', {code: 'validationTimedOut', log: false}));
          } else if (status !== 'ISSUED') {
            return cb(Error.create('Certificate has status "' + status + '". It must have status of "ISSUED" to confirm.', {log: false}));
          }
          cb();
        });
      },
      function(cb) {
        // If we got here is means the certificate has been successfully approved and issued.
        // Now create the CDN distribution.
        req.app.settings.domains.createCdnDistribution(domainName, domain.certificateId, function(err, _distribution) {
          if (err) return cb(err);

          cdnDistribution = _distribution;
          cb();
        });
      },
      function(cb) {
        // Now update the certificate in the database with the cdnDistributionId
        req.app.settings.database.updateDomain({
          orgId: req.ext.organization.orgId,
          domainName: domainName,
          cdnDistributionId: cdnDistribution.distributionId,
          dnsValue: cdnDistribution.domainName,
          status: 'InProgress'
        }, function(err, _domain) {
          if (err) return cb(err);
          domain = _domain;
          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);
      res.json(domain);
    });
  });

  // Delete a domain
  router.delete('/', [ensure.domainManager, hasRole('admin')], function(req, res, next) {
    var domainName = req.body.domainName;
    var domainToDelete;
    var appIdsToClearDomain;

    async.series([
      function(cb) {
        ensureDomainExists(req, domainName, function(err, domain) {
          if (err) return cb(err);
          domainToDelete = domain;
          cb();
        });
      },
      function(cb) {
        // Clear the domainName for all websites that are bound to this domainName
        req.app.settings.database.getAppsByDomain(domainName, function(err, data) {
          if (err) return cb(err);
          appIdsToClearDomain = _.map(data, 'appId');
          cb();
        });
      },
      function(cb) {
        // Unbind any apps from the domainName.
        async.each(appIdsToClearDomain, function(appId, _cb) {
          req.app.settings.database.updateApplication({
            appId: appId,
            domainName: null,
            subDomain: null
          }, _cb);
        }, cb);
      },
      function(cb) {
        if (_.isEmpty(domainToDelete.cdnDistributionId)) return cb();
        req.app.settings.domains.deleteCdnDistribution(domainToDelete.cdnDistributionId, cb);
      },
      function(cb) {
        req.app.settings.database.deleteDomain(req.ext.organization.orgId,
          domainToDelete.domainName, cb);
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
        // Check if this domain is registered as a legacy domain.
        req.app.settings.domains.legacyDomainRegistered(domainName, function(err, registered) {
          if (err) return cb(err);
          if (registered) {
            return cb(Error.http(400, 'Legacy domain name already registered', {
              code: 'legacyDomainRegistered'
            }));
          }
          cb();
        });
      },
      function(cb) {
        req.app.settings.database.getDomain(domainName, function(err, domain) {
          if (err) return cb(err);

          // If the domain already exists and belongs to this org and it doesn't have a
          // cdn distributed assigned yet, then pick up where the previous registration
          // left off.
          if (domain && domain.orgId === req.ext.organization.orgId) {
            domainCheck.existingDomain = domain;
          } else {
            domainCheck.available = !domain;
          }
          cb();
        });
      },
      function(cb) {
        if (!domainCheck.existingDomain) return cb();

        req.app.settings.domains.getCertificateStatus(domainCheck.existingDomain.certificateId, function(err, status) {
          if (err) return cb(err);

          if (status === 'PENDING_VALIDATION') {
            domainCheck.validationError = 'certNotApproved';
          } else if (status === 'VALIDATION_TIMED_OUT') {
            domainCheck.validationError = 'validationTimedOut';
          }

          cb();
        });
      },
      function(cb) {
        if (domainCheck.existingDomain) return cb();

        // Now that we know the domain is available, do a whois lookup to get the list of emails on the record.
        // For the whois lookup, we just want the top level domain.
        debug('whois record check for %s', domainName);
        whois(domainName, function(err, record) {
          if (err) return cb(err);

          if (!record) {
            return cb(Error.http(400, 'No WHOIS record for ' + domainName, {code: 'noWhoisRecord'}));
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

  // Update a domain
  router.put('/', function(req, res, next) {
    async.waterfall([
      function(cb) {
        ensureDomainExists(req, req.body.domainName, cb);
      },
      function(domain, cb) {
        // Add the new subdomain
        req.app.settings.database.updateDomain(_.extend(domain, req.body), cb);
      }
    ], function(err, domain) {
      if (err) return next(err);
      res.json(domain);
    });
  });

  // Resend the validation email
  router.post('/resend-validation', function(req, res, next) {
    var domainName = req.body.domainName;
    var domain;

    async.series([
      function(cb) {
        ensureDomainExists(req, domainName, function(err, _domain) {
          if (err) return cb(err);
          if (!_domain) return cb(new Error('Invalid domain to resend validation'));
          domain = _domain;
          cb();
        });
      },
      function(cb) {
        req.app.settings.domains.resendValidationEmail(domainName, domain.certificateId, cb);
      }
    ], function(err) {
      if (err) return next(err);
      res.status(204).end();
    });
  });

  return router;
};

function validateDomainName(req, res, next) {
  var domainName = req.query.domain || req.body.domainName;

  if (publicSuffixList.isValid(domainName) !== true || publicSuffixList.parse(domainName).domain !== domainName) {
    return next(Error.http(400, 'Invalid domain name', {code: 'invalidDomainName'}));
  }
  next();
}

function ensureDomainExists(req, domainName, callback) {
  req.app.settings.database.getDomain(domainName, function(err, domain) {
    if (err) return callback(err);

    if (!domain) {
      debug('domain %s not found', domainName);
      return callback(Error.http(400, 'Domain ' + domainName + ' not found', {
        code: 'domainNotFound'
      }));
    }

    if (domain.orgId !== req.ext.organization.orgId) {
      return callback(Error.http(403, 'Cannot delete domain %s that does not belong to this org', domain.orgId));
    }

    callback(null, domain);
  });
}
