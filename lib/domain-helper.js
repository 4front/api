var _ = require('lodash');
var async = require('async');

module.exports = {
  createCertificate: function(req, topLevelDomain, callback) {
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
  },

  loadCertificate: function(req, certificateId, topLevelDomain, callback) {
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
  },

  deleteDomain: function(req, domain, callback) {
    async.series([
      function(cb) {
        if (_.isEmpty(domain.zone)) return cb();
        req.app.settings.domains.unregister(domain.domain, domain.zone, cb);
      },
      function(cb) {
        req.app.settings.database.deleteDomain(
          req.ext.organization.orgId, domain.domain, cb);
      }
    ], callback);
  },

  validateDomainName: function(req, res, next) {
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
};
