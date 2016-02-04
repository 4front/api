var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var _ = require('lodash');
var assert = require('assert');
var sinon = require('sinon');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var validateApp = require('../lib/middleware/validate-app');
var helper = require('./helper');

require('dash-assert');

describe('validateApp', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.appData = {
      name: 'test-app'
    };
    this.orgId = shortid.generate();

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        organization: {orgId: self.orgId}
      };
      next();
    });

    this.server.settings.database = this.database = {
      getAppName: function(name, callback) {
        callback(null, self.appName);
      }
    };

    this.server.use(bodyParser.json());

    this.server.post('/:appId?', validateApp(), function(req, res, next) {
      res.json(req.body);
    });

    this.server.use(helper.errorHandler);
  });

  it('returns 400 when app name is invalid', function(done) {
    this.appData.name = '!invalid';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(400)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidAppName');
      })
      .end(done);
  });

  it('returns 400 when app name is blank', function(done) {
    this.appData.name = '';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(400)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidAppName');
      })
      .end(done);
  });

  it('returns 400 when app name is not available', function(done) {
    this.appName = {
      appId: shortid.generate(),
      name: 'taken-name'
    };

    this.appData.name = 'taken-name';
    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(400)
      .expect(function(res) {
        assert.equal(res.body.code, 'appNameUnavailable');
      })
      .end(done);
  });

  it('returns 400 when app name has upper case letters', function(done) {
    this.appData.name = 'InvalidApp';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(400)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidAppName');
      })
      .end(done);
  });

  it('returns 400 when app name contains dots', function(done) {
    this.appData.name = 'invalid.app';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(400)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidAppName');
      })
      .end(done);
  });

  it('returns 200 when app name is available', function(done) {
    this.appName = null;
    this.appData.name = 'valid-name';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(200)
      .end(done);
  });

  it('allows numbers, letters, and dashes', function(done) {
    this.appName = null;
    this.appData.name = 'abcd-1234';

    supertest(this.server)
      .post('/')
      .send(this.appData)
      .expect(200, done);
  });

  describe('domainName', function() {
    beforeEach(function() {
      self = this;

      _.extend(this.appData, {
        domainName: shortid.generate() + '.com',
        subDomain: 'www'
      });

      this.existingDomain = {domainName: this.appData.domainName, orgId: this.orgId};

      this.database.getDomain = sinon.spy(function(domainName, callback) {
        callback(null, self.existingDomain);
      });

      this.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, self.appData.appId);
      });
    });

    it('uses @ subDomain when not specified', function(done) {
      this.appData.subDomain = null;

      supertest(this.server)
        .post('/')
        .send(this.appData)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.subDomain, '@');
        })
        .end(done);
    });

    it('returns 400 when domainName missing from domains table', function(done) {
      self.existingDomain = null;

      supertest(this.server)
        .post('/')
        .send(this.appData)
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'domainNameNotRegistered');
          assert.isTrue(self.database.getDomain.calledWith(self.appData.domainName));
        })
        .end(done);
    });

    it('returns 400 when domain does not belong to organization', function(done) {
      self.existingDomain.orgId = shortid.generate();

      supertest(this.server)
        .post('/')
        .send(this.appData)
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'domainNameForbidden');
          assert.isTrue(self.database.getDomain.calledWith(self.appData.domainName));
        })
        .end(done);
    });

    it('returns 400 if subDomain not available', function(done) {
      this.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, shortid.generate());
      });

      supertest(this.server)
        .post('/')
        .send(this.appData)
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'subDomainNotAvailable');
          assert.isTrue(self.database.getAppIdByDomainName.calledWith(
            self.appData.domainName, self.appData.subDomain));
        })
        .end(done);
    });

    it('returns 400 when apex domain not available', function(done) {
      this.appData.subDomain = null;
      this.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, shortid.generate());
      });

      supertest(this.server)
        .post('/')
        .send(this.appData)
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'apexDomainNotAvailable');
        })
        .end(done);
    });

    it('does not return error if domainName/subDomain valid', function(done) {
      var appId = shortid.generate();

      supertest(this.server)
        .post('/' + appId)
        .send(this.appData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getAppIdByDomainName.calledWith(self.appData.domainName));
        })
        .end(done);
    });
  });
});
