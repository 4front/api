var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var validateApp = require('../lib/middleware/validate-app');
var helper = require('./helper');

describe('validateApp', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.appData = {
      name: 'test-app'
    };

    this.server.use(function(req, res, next) {
      req.ext = {};
      req.ext.user = self.user;
      next();
    });

    this.server.settings.database = this.database = {
      getAppName: function(name, callback) {
        callback(null, self.appName);
      }
    };

    this.server.use(bodyParser.json());

    this.server.post('/', validateApp(), function(req, res, next) {
      res.json(req.ext);
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
        assert.equal(res.body.code, "invalidAppName");
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
        assert.equal(res.body.code, "invalidAppName");
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
        assert.equal(res.body.code, "appNameUnavailable");
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
});
