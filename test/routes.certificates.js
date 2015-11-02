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
      deleteCertificate: sinon.spy(function(certificate, callback) {
        callback(null);
      })
    };

    this.server.use(domainsRoute());
    this.server.use(helper.errorHandler);
  });

  describe('GET /', function() {
    beforeEach(function() {
      self = this;

      this.certificates = _.times(3, function() {
        return {
          name: 'www.' + shortid.generate() + '.com',
          cname: shortid.generate() + '.cloudfront.net',
          status: 'Deployed'
        };
      });

      _.extend(this.database, {
        listCertificates: sinon.spy(function(orgId, callback) {
          callback(null, self.certificates);
        }),
        updateCertificate: sinon.spy(function(certData, callback) {
          callback(null, certData);
        })
      });

      this.domains.getCertificateStatus = sinon.spy(function(certificate, callback) {
        callback(null, 'Deployed');
      });
    });

    it('lists certificates for org', function(done) {
      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.isFalse(self.domains.getCertificateStatus.called);
          assert.isFalse(self.database.updateCertificate.called);
          assert.deepEqual(res.body, self.certificates);
        })
        .end(done);
    });

    it('lists certificates updates status for InProgress certs', function(done) {
      self.certificates[1].status = 'InProgress';

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.domains.getCertificateStatus.callCount, 1);
          assert.isTrue(self.domains.getCertificateStatus.calledWith(self.certificates[1]));
          assert.equal(self.database.updateCertificate.callCount, 1);
          assert.isTrue(self.database.updateCertificate.calledWith({
            name: self.certificates[1].name,
            status: 'Deployed',
            orgId: self.organization.orgId
          }));

          assert.equal(res.body[1].status, 'Deployed');
        })
        .end(done);
    });

    it('lists certificates does not update certs still InProgress', function(done) {
      self.certificates[1].status = 'InProgress';

      this.domains.getCertificateStatus = sinon.spy(function(name, callback) {
        callback(null, 'InProgress');
      });

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.domains.getCertificateStatus.callCount, 1);
          assert.isFalse(self.database.updateCertificate.called);
          assert.equal(res.body[1].status, 'InProgress');
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

      this.database.listDomains = sinon.spy(function(domain, callback) {
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
          assert.isTrue(self.database.listDomains.calledWith(self.organization.orgId));
          assert.equal(self.domains.transferDomain.callCount, 1);
          assert.isTrue(self.domains.transferDomain.calledWith('my.domain.com', certificate.zone, null));
          assert.isTrue(self.database.deleteCertificate.calledWith(self.organization.orgId, certificate.name));
          assert.isTrue(self.domains.deleteCertificate.calledWith(certificate));
        })
        .end(done);
    });
  });
});
