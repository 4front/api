var express = require('express');
var async = require('async');
var _ = require('lodash');
var ensure = require('../middleware/ensure');
var debug = require('debug')('4front:api:domains');

module.exports = function() {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // List the certificates for the organization
  router.get('/', function(req, res, next) {
    async.waterfall([
      function(cb) {
        debug('list certificates for org', req.ext.organization.orgId);
        req.app.settings.database.listCertificates(req.ext.organization.orgId, cb);
      },
      function(certs, cb) {
        // If any of the certificates have a status of InProgress, get an updated status.
        var inProgressCerts = _.filter(certs, {status: 'InProgress'});
        async.each(inProgressCerts, function(cert, nextCert) {
          debug('get status of certificate', cert.name);
          req.app.settings.domains.getCertificateStatus(cert, function(err, status) {
            if (err) return nextCert(err);

            // If the status is no longer 'InProgress', update the value in the database.
            if (status !== 'InProgress') {
              cert.status = status;
              req.app.settings.database.updateCertificate({
                name: cert.name,
                status: status,
                orgId: req.ext.organization.orgId
              }, nextCert);
            } else {
              nextCert();
            }
          });
        }, function(err) {
          if (err) return cb(err);
          cb(null, certs);
        });
      }
    ], function(err, certs) {
      if (err) return next(err);
      res.json(certs);
    });
  });

  // Create a new certificate
  router.post('/', hasRole('admin'), ensure.domainManager, function(req, res, next) {
    var certData = req.body;

    certData.orgId = req.ext.organization.orgId;
    debug('upload SSL cert to org %s', certData.orgId);

    var keyFields = ['privateKey', 'certificateBody', 'certificateChain'];
    async.waterfall([
      function(cb) {
        var certFields = _.pick(certData, keyFields);
        req.app.settings.domains.uploadCertificate(certFields, cb);
      },
      function(certificate, cb) {
        certificate.orgId = req.ext.organization.orgId;
        req.app.settings.database.createCertificate(_.omit(certificate, keyFields), cb);
      }
    ], function(err, certificate) {
      if (err) return next(err);

      res.json(certificate);
    });
  });

  // Delete an SSL certificate
  router.delete('/', [ensure.domainManager, hasRole('admin')], function(req, res, next) {
    if (!req.app.settings.domains) {
      return next(new Error('No domain registrar configured on the 4front application'));
    }

    var certName = req.body.name;
    var certificate;
    var certDomains;

    async.series([
      function(cb) {
        req.app.settings.database.getCertificate(certName, function(err, cert) {
          if (err) return cb(err);

          if (!cert) {
            debug('certificate %s not found', certName);
            return cb(Error.http(404, 'Certificate ' + certName + ' not found', {
              code: 'certificateNotFound'
            }));
          }

          if (cert.orgId !== req.ext.organization.orgId) {
            return cb(Error.http(403, 'Cannot delete certificate %s that does not belong to this org', cert.orgId));
          }

          certificate = cert;
          cb();
        });
      },
      function(cb) {
        // Find all the domains that are bound to this certificate and transfer them to
        // a shared non-SSL zone.
        debug('get domains for org', req.ext.organization.orgId);
        req.app.settings.database.getDomains(req.ext.organization.orgId, function(err, domains) {
          if (err) return cb(err);
          certDomains = _.filter(domains, {certificateId: certificate.certificateId});
          cb();
        });
      },
      function(cb) {
        // Unregister and re-register each domain.
        debug('transfer %s domains out from cert zone', certDomains.length);
        async.each(certDomains, function(domain, done) {
          req.app.settings.domains.transferDomain(domain.domain, domain.zone, null, done);
        }, cb);
      },
      function(cb) {
        debug('delete certificate from database');
        req.app.settings.database.deleteCertificate(req.ext.organization.orgId, certificate.name, cb);
      },
      function(cb) {
        req.app.settings.domains.deleteCertificate(certificate.name, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  return router;
};
