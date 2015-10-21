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

    this.domainZoneId = '123';

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
      register: sinon.spy(function(domainName, callback) {
        callback(null, self.domainZoneId);
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

  // Create new custom domain
  describe('PUT /', function() {
    it('creates new domain', function(done) {
      var appId = shortid.generate();
      var certificateId = shortid.generate();
      var domainName = 'www1.domain.com';

      supertest(this.server)
        .put('/')
        .send({domain: domainName, appId: appId, certificateId: certificateId})
        .expect(200)
        .expect(function() {
          assert.ok(self.domains.register.calledWith(domainName));
          assert.ok(self.database.createDomain.calledWith({
            domain: domainName,
            orgId: self.organization.orgId,
            appId: appId,
            zone: self.domainZoneId,
            certificateId: certificateId
          }));
        })
        .end(done);
    });

    it('domain name invalid', function(done) {
      var orgId = shortid.generate();

      supertest(this.server)
        .put('/')
        .send({domain: 'invaliddomain??', orgId: orgId})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidDomainName');
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
});
