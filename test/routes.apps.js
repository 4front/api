/// <reference path="../typings/mocha/mocha.d.ts"/>
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

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user
      };

      next();
    });

    this.appRegistry = [];
    this.domainZoneId = '123';

    this.server.settings.database = this.database = {
      createApplication: sinon.spy(function(data, callback) {
        callback(null, data);
      }),
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
      createDomain: sinon.spy(function(appId, domain, callback) {
        callback(null, {appId: appId, domain: domain});
      }),
      updateDomain: sinon.spy(function(appId, domain, zoneId, callback) {
        callback();
      }),
      deleteDomain: sinon.spy(function(appId, domain, callback) {
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

    this.server.settings.virtualAppRegistry = this.virtualAppRegistry = {
      getById: function(appId, opts, callback) {
        if (_.isFunction(opts))
          callback = opts;

        callback(null, _.find(self.appRegistry, {appId: appId}));
      },
      getByName: function(name, opts, callback) {
        if (_.isFunction(opts))
          callback = opts;

        callback(null, _.find(self.appRegistry, {name: name}));
      },
      flushApp: sinon.spy(function(app) {
      }),
      add: sinon.spy(function(app) {
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

  describe('POST /', function() {
    var appData = {
      name: 'app-name'
    };

    it('creates app', function(done) {
      supertest(this.server)
        .post('/')
        .send(appData)
        .expect(201)
        .expect(function(res) {
          assert.isMatch(res.body, appData);
          assert.ok(res.body.appId);
          assert.equal(self.user.userId, res.body.ownerId);
          assert.ok(self.database.createApplication.called);
          assert.ok(self.virtualAppRegistry.add.calledWith(sinon.match({appId: res.body.appId})));
        })
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

    this.database.getDomain = sinon.spy(function(domain, callback) {
      callback(null, {
        appId: appData.appId,
        domain: domain,
        zone: self.domainZoneId
      });
    });

    this.appRegistry.push(appData);

    supertest(this.server)
      .delete('/' + appData.appId)
      .expect(204)
      .expect(function(res) {
        assert.ok(self.database.deleteApplication.calledWith(appData.appId));
        assert.ok(self.deployer.versions.deleteAll.called);

        assert.ok(self.domains.unregister.calledWith('one.domain.com'));
        assert.ok(self.domains.unregister.calledWith('two.domain.com'));
        assert.ok(self.virtualAppRegistry.flushApp.called);
      })
      .end(done);
  });

  it('POST /:appId/traffic-rules', function(done) {
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

  // Create new custom domain
  describe('PUT /:appId/domain', function() {
    it('creates new domain', function(done) {
      var appData = {
        appId: shortid.generate(),
        orgId: shortid.generate()
      };

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          appId: appData.appId,
          domain: domain,
          zone: self.domainZoneId
        });
      });

      this.appRegistry.push(appData);

      var domainName = 'my.domain.com';
      supertest(this.server)
        .put('/' + appData.appId + '/domain')
        .send({domainName: domainName})
        .expect(200)
        .expect(function(res) {
          assert.ok(self.domains.register.calledWith(domainName));
          assert.ok(self.database.createDomain.calledWith(appData.appId, domainName));
          assert.ok(self.database.updateDomain.calledWith(appData.appId, domainName, self.domainZoneId));
        })
        .end(done);
    });

    it('domain name invalid', function(done) {
      var appData = {
        appId: shortid.generate(),
        orgId: shortid.generate()
      };

      this.appRegistry.push(appData);

      supertest(this.server)
        .put('/' + appData.appId + '/domain')
        .send({domainName: 'invaliddomain??'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidDomainName');
        })
        .end(done);
    });
  });

  describe('DELETE /:appId/domain', function() {
    it('deletes a domain', function(done) {
      var virtualApp = {
        appId: shortid.generate(),
        orgId: shortid.generate()
      };

      this.appRegistry.push(virtualApp);

      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          appId: virtualApp.appId,
          domain: domainName,
          zone: self.domainZoneId
        });
      });

      supertest(this.server)
        .delete('/' + virtualApp.appId + '/domain')
        .send({domainName: domainName})
        .expect(200)
        .expect(function(res) {
          assert.ok(self.database.getDomain.calledWith(domainName));
          assert.ok(self.domains.unregister.calledWith(domainName, self.domainZoneId));
          assert.ok(self.database.deleteDomain.calledWith(virtualApp.appId, domainName));
        })
        .end(done);
    });

    it('delete domain belonging to different app', function(done) {
      var virtualApp = {
        appId: shortid.generate(),
        orgId: shortid.generate()
      };

      this.appRegistry.push(virtualApp);

      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, {
          appId: shortid.generate(), // return a different appId
          domain: domainName,
          zone: self.domainZoneId
        });
      });

      supertest(this.server)
        .delete('/' + virtualApp.appId + '/domain')
        .send({domainName: domainName})
        .expect(403)
        .end(done);
    });

    it('delete a missing domain', function(done) {
      var virtualApp = {
        appId: shortid.generate(),
        orgId: shortid.generate()
      };

      this.appRegistry.push(virtualApp);

      var domainName = 'my.domain.com';

      this.database.getDomain = sinon.spy(function(domain, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .delete('/' + virtualApp.appId + '/domain')
        .send({domainName: domainName})
        .expect(404)
        .end(done);
    });
  });
});
