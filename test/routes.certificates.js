var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
// var moment = require('moment');
// var async = require('async');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var domainsRoute = require('../lib/routes/certificates');
var helper = require('./helper');

require('dash-assert');

describe('routes/certificates', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.user = {
      userId: shortid.generate(),
      username: 'tester',
      secretKey: shortid.generate()
    };

    this.organization = {
      orgId: shortid.generate()
    };

    this.orgMember = {
      userId: self.user.userId,
      orgId: this.organization.orgId,
      role: 'admin'
    };

    this.server.use(bodyParser.json());

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        organization: self.organization,
        orgMember: self.orgMember
      };

      next();
    });

    this.uploadedCertificate = {
      certificateId: shortid.generate(),
      zone: shortid.generate(),
      expires: new Date(Date.now() + 60000 * 60 * 24 * 365),
      uploadDate: new Date()
    };

    this.server.settings.database = this.database = {
      createCertificate: sinon.spy(function(certData, callback) {
        callback(null, certData);
      }),
      updateCertificate: sinon.spy(function(certData, callback) {
        callback(null, certData);
      }),
      deleteCertificate: sinon.spy(function(orgId, certName, callback) {
        callback();
      })
    };

    this.server.settings.domains = this.domains = {
      uploadCertificate: sinon.spy(function(certData, callback) {
        callback(null, _.extend({}, certData, self.uploadedCertificate));
      }),
      deleteCertificate: sinon.spy(function(certName, callback) {
        callback(null);
      })
    };

    this.server.use(domainsRoute());
    this.server.use(helper.errorHandler);
  });

  describe('GET /', function() {
    it('lists certificates for org', function(done) {
      var certs = _.times(3, function() {
        return {
          name: 'www.' + shortid.generate() + '.com'
        };
      });

      this.server.settings.database.listCertificates = sinon.spy(function(orgId, callback) {
        callback(null, certs);
      });

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body, certs);
        })
        .end(done);
    });
  });

  // Create new certificate
  describe('POST /', function() {
    it('creates new certificate', function(done) {
      var certData = {
        privateKey: 'asdfasdg',
        certificateBody: 'shfdghdhfg',
        certificateChain: 'adfgsdg'
      };

      supertest(this.server)
        .post('/')
        .send(certData)
        .expect(200)
        .expect(function() {
          assert.ok(self.domains.uploadCertificate.calledWith(certData));
          assert.ok(self.database.createCertificate.called);

          assert.ok(self.database.createCertificate.calledWith(
            _.extend({}, self.uploadedCertificate, {orgId: self.organization.orgId})));
        })
        .end(done);
    });
  });

  describe('DELETE /', function() {
    it('deletes a certificate', function(done) {
      var certificate = {
        certificateId: shortid.generate(),
        name: '*.domain.com',
        zone: shortid.generate(),
        orgId: this.organization.orgId
      };

      // Create two domains for the org, one bound to the cert and another that is not.
      var certDomains = [
        {domain: 'my.domain.com', orgId: this.organization.orgId, certificateId: certificate.certificateId, zone: certificate.zone},
        {domain: 'my.otherdomain.com', orgId: this.organization.orgId, zone: shortid.generate()}
      ];

      this.database.getCertificate = sinon.spy(function(certName, callback) {
        callback(null, certificate);
      });

      this.database.getDomains = sinon.spy(function(domain, callback) {
        callback(null, certDomains);
      });

      this.domains.transferDomain = sinon.spy(function(domain, currentZone, targetZone, cb) {
        cb();
      });

      this.database.deleteCertificate = sinon.spy(function(orgId, certificateId, cb) {
        cb();
      });

      supertest(this.server)
        .delete('/')
        .send({name: certificate.name})
        .expect(204)
        .expect(function() {
          assert.isTrue(self.database.getCertificate.calledWith(certificate.name));
          assert.isTrue(self.database.getDomains.calledWith(self.organization.orgId));
          assert.equal(self.domains.transferDomain.callCount, 1);
          assert.isTrue(self.domains.transferDomain.calledWith('my.domain.com', certificate.zone, null));
          assert.isTrue(self.database.deleteCertificate.calledWith(self.organization.orgId, certificate.name));
          assert.isTrue(self.domains.deleteCertificate.calledWith(certificate.name));
        })
        .end(done);
    });

  //   it('delete domain belonging to different organization', function(done) {
  //     var domainName = 'my.domain.com';
  //
  //     this.database.getDomain = sinon.spy(function(domain, callback) {
  //       callback(null, {
  //         orgId: shortid.generate(), // return a different appId
  //         domain: domainName
  //       });
  //     });
  //
  //     supertest(this.server)
  //       .delete('/')
  //       .send({domain: domainName})
  //       .expect(403)
  //       .end(done);
  //   });
  //
  //   it('delete a missing domain', function(done) {
  //     var domainName = 'my.domain.com';
  //
  //     this.database.getDomain = sinon.spy(function(domain, callback) {
  //       callback(null, null);
  //     });
  //
  //     supertest(this.server)
  //       .delete('/')
  //       .send({domain: domainName})
  //       .expect(404)
  //       .end(done);
  //   });
  });
});
