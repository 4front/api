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
    req.app.settings.database.listCertificates(req.ext.organization.orgId, function(err, certs) {
      if (err) return next(err);

      res.json(certs);
    });
  });

  // Create a new certificate
  router.put('/', hasRole('admin'), ensure.domainManager, function(req, res, next) {
    var certData = req.body;

    certData.orgId = req.ext.organization.orgId;
    debug('upload SSL cert %s to org %s', certData.name, certData.orgId);

    async.waterfall([
      function(cb) {
        var certFields = _.pick(certData, 'name', 'privateKey', 'certificateBody', 'certificateChain');
        req.app.settings.domains.uploadCertificate(certFields, cb);
      },
      function(certificate, cb) {
        certificate.orgId = req.ext.organization.orgId;
        req.app.settings.database.createCertificate(certificate, cb);
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
    async.waterfall([
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

          cb(null, cert);
        });
      },
      function(certificate, cb) {
        req.app.settings.domains.deleteCertificate(certificate, function(err) {
          cb(err, certificate);
        });
      },
      function(certificate, cb) {
        req.app.settings.database.deleteCertificate(req.ext.organization.orgId, certificate.name, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  return router;
};
