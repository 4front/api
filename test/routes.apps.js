var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var appsRoute = require('../lib/routes/apps');
var helper = require('./helper');

require('dash-assert');

describe('routes/apps', function() {
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
      orgId: shortid.generate(),
      environments: ['test', 'production']
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
        orgMember: self.orgMember
      };

      next();
    });

    this.appRegistry = [];

    this.server.settings.database = this.database = {
      updateApplication: sinon.spy(function(data, callback) {
        callback(null, data);
      }),
      deleteApplication: sinon.spy(function(appId, callback) {
        callback(null);
      }),
      updateTrafficRules: sinon.spy(function(appId, environment, rules, callback) {
        callback(null);
      }),
      getAppName: function(name, callback) {
        callback(null, self.appName);
      },
      getOrganization: function(orgId, callback) {
        callback(null, self.organization);
      },
      getOrgMember: function(orgId, userId, callback) {
        callback(null, self.orgMember);
      },
      updateDomain: sinon.spy(function(domainData, callback) {
        callback(null, domainData);
      })
    };

    this.server.settings.virtualAppRegistry = this.virtualAppRegistry = {
      getById: function(appId, opts, callback) {
        if (_.isFunction(opts)) {
          callback = opts;
        }

        callback(null, _.find(self.appRegistry, {appId: appId}));
      },
      getByName: function(name, opts, callback) {
        if (_.isFunction(opts)) {
          callback = opts;
        }

        callback(null, _.find(self.appRegistry, {name: name}));
      },
      flushApp: sinon.spy(function() {
      })
    };

    this.server.settings.deployer = this.deployer = {
      versions: {
        deleteAll: sinon.spy(function(appId, context, callback) {
          callback();
        })
      }
    };

    // Register middleware for handling the appId parameter
    this.server.use(appsRoute());

    this.server.use(helper.errorHandler);
  });

  describe('GET /:appId', function() {
    it('omits env variables', function(done) {
      var appData = {
        appId: shortid.generate(),
        name: 'appname',
        env: {
          production: {
            key: {
              value: 'foo'
            }
          }
        }
      };

      this.appRegistry.push(appData);

      supertest(this.server)
        .get('/' + appData.appId)
        .expect(200)
        .expect(function(res) {
          _.isUndefined(res.body.env);
        })
        .end(done);
    });
  });

  describe('HEAD /:appName', function() {
    it('existing app name', function(done) {
      var appData = {appId: shortid.generate(), name: 'appname'};
      this.appRegistry.push(appData);

      supertest(this.server)
        .head('/' + appData.name)
        .expect(200)
        .end(done);
    });

    it('non existing app name', function(done) {
      supertest(this.server)
        .head('/someappname')
        .expect(404)
        .end(done);
    });
  });

  it('PUT /:appId', function(done) {
    var appData = {
      appId: shortid.generate(),
      name: 'updated-name',
      orgId: shortid.generate()
    };

    this.appRegistry.push(appData);

    supertest(this.server)
      .put('/' + appData.appId)
      .send(appData)
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.name, 'updated-name');
        assert.ok(self.database.updateApplication.called);
      })
      .end(done);
  });

  it('DELETE /:appId', function(done) {
    var appData = {
      appId: shortid.generate(),
      orgId: shortid.generate(),
      domains: ['one.domain.com', 'two.domain.com']
    };

    this.appRegistry.push(appData);

    supertest(this.server)
      .delete('/' + appData.appId)
      .expect(204)
      .expect(function() {
        assert.ok(self.database.deleteApplication.calledWith(appData.appId));
        assert.ok(self.deployer.versions.deleteAll.called);
        assert.ok(self.virtualAppRegistry.flushApp.called);
      })
      .end(done);
  });

  it('POST /:appId/traffic-rules/:env', function(done) {
    var appData = {appId: shortid.generate(), orgId: shortid.generate()};
    this.appRegistry.push(appData);

    var environment = 'production';
    var rules = [{version: 'v1', rule: '*'}];

    supertest(this.server)
      .post('/' + appData.appId + '/traffic-rules/' + environment)
      .send(rules)
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body, rules);
        assert.ok(self.database.updateTrafficRules.calledWith(appData.appId, environment));
      })
      .end(done);
  });

  it('DELETE /:appId/traffic-rules/:env', function(done) {
    var appData = {appId: shortid.generate(), orgId: shortid.generate(), trafficRules: {
      prod: [{version: '123', rule: '*'}],
      test: [{version: '456', rule: '*'}]
    }};

    this.database.deleteTrafficRules = sinon.spy(function(appId, env, callback) {
      callback();
    });

    this.appRegistry.push(appData);
    supertest(this.server)
      .del('/' + appData.appId + '/traffic-rules/test')
      .expect(204)
      .expect(function(res) {
        assert.ok(self.database.deleteTrafficRules.calledWith(appData.appId, 'test'));
      })
      .end(done);
  });
});
