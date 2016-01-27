var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
// var async = require('async');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var domainsRoute = require('../lib/routes/domains');
var helper = require('./helper');

require('dash-assert');

describe('routes/domains', function() {
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

    this.domainZoneId = shortid.generate();

    this.server.settings.database = this.database = {
      createDomain: sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      }),
      updateDomain: sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      }),
      deleteDomain: sinon.spy(function(orgId, domain, callback) {
        callback();
      })
    };

    this.server.settings.domains = this.domains = {
      register: sinon.spy(function(domainName, zone, callback) {
        callback(null, zone);
      }),
      unregister: sinon.spy(function(domainName, zoneId, callback) {
        callback(null);
      })
    };

    this.server.use(domainsRoute());
    this.server.use(helper.errorHandler);
  });

  describe('GET /', function() {
    it('lists domains for org', function(done) {
      var domains = _.times(3, function() {
        return {
          domain: 'www.' + shortid.generate() + '.com'
        };
      });

      this.server.settings.database.listDomains = sinon.spy(function(orgId, callback) {
        callback(null, domains);
      });

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body, domains);
        })
        .end(done);
    });
  });

  // Request a new custom domain
  describe('POST /request', function() {
    beforeEach(function() {
      self = this;

      this.certificateId = shortid.generate();
      // this.zoneId = sho
      this.topLevelDomain = shortid.generate().toLowerCase() + '.com';

      this.domains.requestWildcardCertificate = sinon.spy(function(topLevelDomain, callback) {
        callback(null, self.certificateId);
      });

      _.extend(this.database, {
        createCertificate: sinon.spy(function(certData, callback) {
          callback(null, certData);
        }),
        getCertificate: sinon.spy(function(certificateId, callback) {
          callback(null, {
            certificateId: certificateId,
            zone: self.domainZoneId,
            domain: '*.' + self.topLevelDomain
          });
        })
      });
    });

    it('requests domain along with new certificate', function(done) {
      supertest(this.server)
        .post('/request')
        .send({domain: 'www.' + this.topLevelDomain})
        .expect(function(res) {
          assert.isTrue(self.domains.requestWildcardCertificate.calledWith(self.topLevelDomain));

          assert.isTrue(self.database.createCertificate.calledWith({
            certificateId: self.certificateId,
            orgId: self.organization.orgId,
            commonName: '*.' + self.topLevelDomain,
            name: self.topLevelDomain,
            status: 'Pending'
          }));

          assert.isTrue(self.database.createDomain.calledWith({
            orgId: self.organization.orgId,
            domain: 'www.' + self.topLevelDomain,
            zone: sinon.match(_.isUndefined),
            certificateId: self.certificateId
          }));
        })
        .end(done);
    });

    it('requests domain with existing wildcard certificate', function(done) {
      supertest(this.server)
        .post('/request')
        .send({domain: 'www.' + this.topLevelDomain, certificate: self.certificateId})
        .expect(function(res) {
          assert.isFalse(self.domains.requestWildcardCertificate.called);
          assert.isFalse(self.database.createCertificate.called);
          assert.isTrue(self.database.getCertificate.calledWith(self.certificateId));

          assert.isTrue(self.database.createDomain.calledWith({
            orgId: self.organization.orgId,
            domain: 'www.' + self.topLevelDomain,
            zone: self.domainZoneId,
            certificateId: self.certificateId
          }));
        })
        .end(done);
    });

    it('requests domain with mis-matched wildcard certificate', function(done) {
      this.database.getCertificate = function(certificateId, callback) {
        callback(null, {
          certificateId: certificateId,
          zone: self.domainZoneId,
          domain: '*.someotherdomain.com'
        });
      };

      supertest(this.server)
        .post('/request')
        .send({domain: 'www.' + this.topLevelDomain, certificate: self.certificateId})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'misMatchedCertificate');
        })
        .end(done);
    });

    it('apex domain name invalid', function(done) {
      supertest(this.server)
        .post('/request')
        .send({domain: 'domain.com'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidDomainName');
        })
        .end(done);
    });
  });

  describe('PUT /', function() {
    beforeEach(function() {
      self = this;

      this.existingDomain = {
        domain: 'www.domain.com',
        zone: shortid.generate(),
        appId: shortid.generate()
      };

      this.certificate = {
        name: '*.domain.com',
        zone: shortid.generate()
      };

      this.sharedZone = shortid.generate();

      _.extend(this.database, {
        getDomain: sinon.spy(function(domainName, callback) {
          callback(null, self.existingDomain);
        }),
        getCertificate: sinon.spy(function(certName, callback) {
          callback(null, self.certificate);
        }),
        updateDomain: sinon.spy(function(domainData, callback) {
          callback(null, domainData);
        })
      });

      _.extend(this.domains, {
        transferDomain: sinon.spy(function(domainName, currentZone, targetZone, callback) {
          callback(null, targetZone || self.sharedZone);
        })
      });
    });

    it('updates domain from no cert to cert', function(done) {
      var domainData = {
        domain: this.existingDomain.domain,
        certificate: this.certificate.name,
        appId: this.existingDomain.appId
      };

      supertest(this.server)
        .put('/')
        .send(domainData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(domainData.domain));
          assert.isTrue(self.database.getCertificate.calledWith(domainData.certificate));

          // Domain should be transferred from the original zone to the
          // zone of the certificate.
          assert.isTrue(self.domains.transferDomain.calledWith(domainData.domain,
            self.existingDomain.zone, self.certificate.zone));

          var updateDomainExpectedArg = _.extend(domainData, {
            certificate: self.certificate.name,
            zone: self.certificate.zone,
            orgId: self.organization.orgId
          });

          assert.isTrue(self.database.updateDomain.calledWith(updateDomainExpectedArg));
        })
        .end(done);
    });

    it('updates domain from cert to no cert', function(done) {
      var domainData = {
        domain: this.existingDomain.domain,
        certificate: null,
        appId: shortid.generate()
      };

      this.existingDomain.certificate = this.certificate.name;
      this.existingDomain.zone = this.certificate.zone;

      supertest(this.server)
        .put('/')
        .send(domainData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(domainData.domain));
          assert.isFalse(self.database.getCertificate.called);

          // Domain should be transferred from certificate zone to
          // an unspecified null zone. The transferDomain function will choose
          // the first available shared zone for non SSL domains.
          assert.isTrue(self.domains.transferDomain.calledWith(
            domainData.domain, self.existingDomain.zone, null));

          assert.isTrue(self.database.updateDomain.calledWith(_.extend(domainData, {
            zone: self.sharedZone,
            certificate: null,
            orgId: self.organization.orgId
          })));
        })
        .end(done);
    });

    it('updates non-SSL domain and it remains non-SSL', function(done) {
      var domainData = {
        domain: this.existingDomain.domain,
        certificate: null,
        appId: shortid.generate()
      };

      supertest(this.server)
        .put('/')
        .send(domainData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(domainData.domain));
          assert.isFalse(self.database.getCertificate.called);

          // domain should not be transferred since it was not and is not
          // associated with a certificate
          assert.isFalse(self.domains.transferDomain.called);

          assert.isTrue(self.database.updateDomain.calledWith(_.extend(domainData, {
            zone: self.existingDomain.zone,
            certificate: null,
            orgId: self.organization.orgId
          })));
        })
        .end(done);
    });
  });

  describe('DELETE /', function() {
    it('deletes a domain', function(done) {
      var appId = shortid.generate();
      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          appId: appId,
          orgId: self.organization.orgId,
          domain: domainName,
          zone: self.domainZoneId
        });
      });

      supertest(this.server)
        .delete('/')
        .send({domain: domainName})
        .expect(204)
        .expect(function() {
          assert.ok(self.database.getDomain.calledWith(domainName));
          assert.ok(self.domains.unregister.calledWith(domainName, self.domainZoneId));
          assert.ok(self.database.deleteDomain.calledWith(self.organization.orgId, domainName));
        })
        .end(done);
    });

    it('delete domain belonging to different organization', function(done) {
      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          orgId: shortid.generate(), // return a different appId
          domain: domainName
        });
      });

      supertest(this.server)
        .delete('/')
        .send({domain: domainName})
        .expect(403)
        .end(done);
    });

    it('delete a missing domain', function(done) {
      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .delete('/')
        .send({domain: domainName})
        .expect(404)
        .end(done);
    });
  });

  describe('GET /check', function() {
    it('domain is available if not exists in database', function(done) {
      this.timeout(20000);

      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, null);
      });

      var domainName = 'www.github.com';
      supertest(this.server)
        .get('/check')
        .query({domain: domainName})
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(domainName));
          assert.isTrue(res.body.available);
          assert.equal(res.body.domainName, 'github.com');
          assert.equal(res.body.registrantEmail, 'hostmaster@github.com');
        })
        .end(done);
    });

    it('domain available is false if already exists in database', function(done) {
      this.timeout(20000);
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, {domain: name});
      });

      var domainName = 'www.github.com';
      supertest(this.server)
        .get('/check')
        .query({domain: domainName})
        .expect(200)
        .expect(function(res) {
          assert.isFalse(res.body.available);
          assert.equal(res.body.domainName, 'github.com');
          assert.equal(res.body.registrantEmail, 'hostmaster@github.com');
        })
        .end(done);
    });

    it('returns noWhoisRecord for missing domain', function(done) {
      this.timeout(20000);
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .get('/check')
        .query({domain: 'www.345345afgkadjf.net'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'noWhoisRecord');
        })
        .end(done);
    });
  });
});
