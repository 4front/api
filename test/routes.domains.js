var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var helper = require('./helper');
var domainsRoute = require('../lib/routes/domains');

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

    this.certificateId = shortid.generate();
    this.domainName = Date.now() + _.random(11, 99) + '.com';

    this.server.settings.database = this.database = {};
    this.server.settings.domains = this.domains = {};

    this.server.use(bodyParser.json());
    this.server.use(domainsRoute());
    this.server.use(helper.errorHandler);
  });

  describe('GET /', function() {
    beforeEach(function() {
      self = this;
      this.domainList = _.times(3, function() {
        return {
          domainName: shortid.generate() + '.com',
          orgId: self.organization.orgId,
          cdnDistributionId: shortid.generate(),
          status: 'Deployed'
        };
      });

      _.extend(this.database, {
        listDomains: sinon.spy(function(orgId, callback) {
          callback(null, self.domainList);
        }),
        updateDomain: sinon.spy(function(domainData, callback) {
          callback(null, domainData);
        })
      });

      this.domains.getCdnDistributionStatus = sinon.spy(function(distributionId, callback) {
        callback(null, 'Deployed');
      });
    });

    it('lists domains for org', function(done) {
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(3, res.body.length);
          assert.deepEqual(res.body, self.domainList);
        })
        .end(done);
    });

    it('lists domain updates status for InProgress domains', function(done) {
      this.domainList[1].status = 'InProgress';

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.domains.getCdnDistributionStatus.callCount, 1);
          assert.isTrue(self.domains.getCdnDistributionStatus.calledWith(self.domainList[1].cdnDistributionId));
          assert.equal(self.database.updateDomain.callCount, 1);
          assert.isTrue(self.database.updateDomain.calledWith({
            domainName: self.domainList[1].domainName,
            status: 'Deployed',
            orgId: self.organization.orgId
          }));

          assert.equal(res.body[1].status, 'Deployed');
        })
        .end(done);
    });

    it('lists domains does not update domains still InProgress', function(done) {
      self.domainList[1].status = 'InProgress';

      this.domains.getCdnDistributionStatus = sinon.spy(function(name, callback) {
        callback(null, 'InProgress');
      });

      supertest(this.server).get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.domains.getCdnDistributionStatus.callCount, 1);
          assert.isFalse(self.database.updateDomain.called);
          assert.equal(res.body[1].status, 'InProgress');
        })
        .end(done);
    });
  });

  // Request a new domain
  describe('POST /request', function() {
    beforeEach(function() {
      self = this;

      this.database.createDomain = sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      });

      this.domains.requestWildcardCertificate = sinon.spy(function(domainName, callback) {
        callback(null, self.certificateId);
      });
    });

    it('requests available domain', function(done) {
      this.database.getDomain = sinon.spy(function(domainName, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .post('/request')
        .send({domainName: this.domainName})
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(self.domainName));
          assert.isTrue(self.domains.requestWildcardCertificate.calledWith(self.domainName));

          assert.isTrue(self.database.createDomain.calledWith({
            orgId: self.organization.orgId,
            domainName: self.domainName,
            certificateId: self.certificateId,
            status: 'Pending'
          }));

          assert.isMatch(res.body, {
            orgId: self.organization.orgId,
            certificateId: self.certificateId,
            domainName: self.domainName,
            status: 'Pending'
          });
        })
        .end(done);
    });

    it('returns error if requesting unavailable domain', function(done) {
      this.database.getDomain = function(domainName, callback) {
        callback(null, {domainName: domainName});
      };

      supertest(this.server)
        .post('/request')
        .send({domainName: this.domainName})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'domainNotAvailable');
          assert.isFalse(self.domains.requestWildcardCertificate.called);
          assert.isFalse(self.database.createDomain.called);
        })
        .end(done);
    });

    it('returns error for invalid tld', function(done) {
      supertest(this.server)
        .post('/request')
        .send({domainName: 'domain.notatld'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidDomainName');
        })
        .end(done);
    });

    it('returns error for subdomain', function(done) {
      supertest(this.server)
        .post('/request')
        .send({domainName: 'www.domain.com'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidDomainName');
        })
        .end(done);
    });
  });

  describe('POST /confirm', function() {
    beforeEach(function() {
      self = this;
      this.cdnDistribution = {
        distributionId: shortid.generate(),
        domainName: shortid.generate() + '.cloudfront.net',
        status: 'InProgress'
      };

      this.database.getDomain = sinon.spy(function(domainName, callback) {
        callback(null, {
          domainName: domainName,
          orgId: self.organization.orgId,
          certificateId: self.certificateId
        });
      });

      this.domains.createCdnDistribution = sinon.spy(function(domainName, certificateId, callback) {
        callback(null, self.cdnDistribution);
      });

      this.database.updateDomain = sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      });

      this.domains.getCertificateStatus = sinon.spy(function(certificateId, callback) {
        callback(null, self.certificateStatus || 'ISSUED');
      });
    });

    it('confirm verified domain', function(done) {
      self.certificateStatus = 'ISSUED';

      supertest(this.server)
        .post('/confirm')
        .send({domainName: this.domainName})
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(self.domainName));
          assert.isTrue(self.domains.getCertificateStatus.calledWith(self.certificateId));
          assert.isTrue(self.domains.createCdnDistribution.calledWith(self.domainName, self.certificateId));

          var expectedDomain = {
            domainName: self.domainName,
            cdnDistributionId: self.cdnDistribution.distributionId,
            dnsValue: self.cdnDistribution.domainName,
            status: 'InProgress'
          };

          assert.isTrue(self.database.updateDomain.calledWith(expectedDomain));
          assert.deepEqual(res.body, expectedDomain);
        })
        .end(done);
    });

    it('confirm domain when certificate is VALIDATION_TIMED_OUT', function(done) {
      self.certificateStatus = 'VALIDATION_TIMED_OUT';

      supertest(this.server)
        .post('/confirm')
        .send({domainName: this.domainName})
        .expect(500)
        .expect(function(res) {
          assert.equal(res.body.code, 'validationTimedOut');
          assert.isFalse(self.domains.createCdnDistribution.called);
          assert.isFalse(self.database.updateDomain.called);
        })
        .end(done);
    });

    it('confirm domain when certificate is PENDING_VALIDATION', function(done) {
      this.domains.getCertificateStatus = sinon.spy(function(certificateId, callback) {
        callback(null, 'PENDING_VALIDATION');
      });

      supertest(this.server)
        .post('/confirm')
        .send({domainName: this.domainName})
        .expect(500)
        .expect(function(res) {
          assert.equal(res.body.code, 'certNotApproved');
          assert.isFalse(self.domains.createCdnDistribution.called);
          assert.isFalse(self.database.updateDomain.called);
        })
        .end(done);
    });
  });

  describe('PUT /', function() {
    it('updates domain', function(done) {
      this.database.updateDomain = sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      });

      this.database.getDomain = sinon.spy(function(domainName, callback) {
        callback(null, {
          orgId: self.organization.orgId,
          domainName: self.domainName,
          dnsValue: '1234.cloudfront.net'
        });
      });

      supertest(this.server)
        .put('/')
        .send({domainName: self.domainName, subDomains: {www: '123'}})
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(self.domainName));
          assert.isTrue(self.database.updateDomain.calledWith({
            orgId: self.organization.orgId,
            domainName: self.domainName,
            dnsValue: '1234.cloudfront.net',
            subDomains: {www: '123'}
          }));
        })
        .end(done);
    });
  });

  describe('DELETE /', function() {
    it('deletes a domain', function(done) {
      var distributionId = shortid.generate();
      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          orgId: self.organization.orgId,
          domainName: self.domainName,
          certificateId: self.certificateId,
          cdnDistributionId: distributionId
        });
      });

      this.database.deleteDomain = sinon.spy(function(orgId, domain, callback) {
        callback();
      });

      this.domains.deleteCertificate = sinon.spy(function(certificateId, callback) {
        callback();
      });

      this.domains.deleteCdnDistribution = sinon.spy(function(domain, callback) {
        callback(null);
      });

      supertest(this.server)
        .delete('/')
        .send({domainName: self.domainName})
        .expect(204)
        .expect(function() {
          assert.isTrue(self.database.getDomain.calledWith(self.domainName));
          assert.isTrue(self.database.deleteDomain.calledWith(self.organization.orgId, self.domainName));
          assert.isTrue(self.domains.deleteCdnDistribution.calledWith(distributionId));
          assert.isTrue(self.domains.deleteCertificate.calledWith(self.certificateId));
        })
        .end(done);
    });

    it('delete domain belonging to different organization', function(done) {
      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          orgId: shortid.generate(), // return a different orgId
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
      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .delete('/')
        .send({domainName: self.domainName})
        .expect(400)
        .end(done);
    });
  });

  describe('GET /check', function() {
    it('domain is available if not exists in database', function(done) {
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, null);
      });

      var domainName = 'github.com';
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
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, {domain: name});
      });

      var domainName = 'github.com';
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

    it('sets existingDomain if pending domain exists for org', function(done) {
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, {
          domainName: self.domainName,
          orgId: self.organization.orgId,
          certificateId: self.certificateId
        });
      });

      this.domains.getCertificateStatus = sinon.spy(function(certificateId, callback) {
        callback(null, 'PENDING_VALIDATION');
      });

      supertest(this.server)
        .get('/check')
        .query({domain: self.domainName})
        .expect(200)
        .expect(function(res) {
          assert.isObject(res.body.existingDomain);
          assert.equal(res.body.existingDomain.domainName, self.domainName);
          assert.isTrue(self.domains.getCertificateStatus.calledWith(self.certificateId));
          assert.equal(res.body.validationError, 'certNotApproved');
          assert.isUndefined(res.body.registrar);
        })
        .end(done);
    });

    it('returns noWhoisRecord for missing domain', function(done) {
      this.database.getDomain = sinon.spy(function(name, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .get('/check')
        .query({domain: 'missing-345345afgkadjf.net'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'noWhoisRecord');
        })
        .end(done);
    });
  });
});
