var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:api:test');
var helper = require('./helper');
var envRoute = require('../lib/routes/env');

describe('routes.env', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.appId = shortid.generate();
    this.virtualApp = {
      appId: this.appId
    }

    this.server.use(function(req, res, next) {
      req.ext = {
        organization: {
          orgId: shortid.generate(),
          environments: ['test', 'production']
        },
        orgMember: {
          role: 'admin'
        },
        virtualApp: self.virtualApp
      };

      next();
    });

    this.server.settings.database = this.database = {
      setEnvironmentVariable: sinon.spy(function(options, callback) {
        callback(null);
      }),
      deleteEnvironmentVariable: sinon.spy(function(appId, env, key, callback) {
        callback(null);
      })
    };

    this.server.settings.virtualAppRegistry = this.virtualAppRegistry = {
      flushApp: sinon.spy(function(app) {})
    };

    this.server.use(envRoute());
    this.server.use(helper.errorHandler);
  });

  describe('PUT /:env/:key', function() {
    it('set value for _default virtualEnv', function(done) {
      var key = 'SOME_SETTING';
      var value = 'config_value';

      supertest(this.server)
        .put('/' + key)
        .send({value: value})
        .expect(200)
        .expect(function(res) {
          self.database.setEnvironmentVariable.calledWith(sinon.match({
            appId: self.appId,
            virtualEnv: '_default',
            value: value,
            key: key
          }));

          assert.ok(self.virtualAppRegistry.flushApp.calledWith(sinon.match({appId: self.appId})));
        })
        .end(done);
    });

    it('sets value for specified environment', function(done) {
      var key = 'SOME_SETTING';
      var value = 'config_value';

      supertest(this.server)
        .put('/production/' + key)
        .send({value: value})
        .expect(200)
        .expect(function(res) {
          self.database.setEnvironmentVariable.calledWith(sinon.match({
            virtualEnv: 'production',
            value: value,
            key: key
          }));
        })
        .end(done);
    });

    it('returns 404 error if environment not valid', function(done) {
      var key = 'SOME_SETTING';
      var value = 'config_value';

      supertest(this.server)
        .put('/invalid/' + key)
        .send({value: value})
        .expect(404)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidVirtualEnv');
        })
        .end(done);
    });

    it('returns 400 error if value missing', function(done) {
      var key = 'SOME_SETTING';

      supertest(this.server)
        .put('/test/' + key)
        .send({})
        .expect(400)
        .end(done);
    });
  });

  describe('DELETE /:env/:key', function() {
    it('deletes env variable', function(done) {
      var key = 'KEY';

      supertest(this.server)
        .delete('/test/' + key)
        .expect(204)
        .expect(function(res) {
          assert.ok(self.database.deleteEnvironmentVariable.calledWith(self.appId, 'test', key));
          assert.ok(self.virtualAppRegistry.flushApp.calledWith(sinon.match({appId: self.appId})));
        })
        .end(done);
    });

    it('default environment', function(done) {
      var key = 'KEY';

      supertest(this.server)
        .delete('/' + key)
        .expect(204)
        .expect(function(res) {
          assert.ok(self.database.deleteEnvironmentVariable.calledWith(self.appId, '_global', key));
        })
        .end(done);
    });
  });

  describe('GET /env', function() {
    beforeEach(function() {
      self = this;
      this.virtualApp.env = {
        _global: {
          KEY1: 'value1'
        },
        test: {
          KEY2: 'test-value'
        },
        production: {
          KEY2: 'prod-value'
        }
      };
    });

    it('lists all env variables', function(done) {
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body, self.virtualApp.env);
          assert.equal(res.body.test.KEY2, 'test-value');
        })
        .end(done);
    });

    it('lists env specific variables', function(done) {
      supertest(this.server)
        .get('/test')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body, self.virtualApp.env.test);
        })
        .end(done);
    });
  });
});
