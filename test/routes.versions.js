var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var debug = require('debug')('4front-api:test');
var versionsRoute = require('../lib/routes/versions');
var helper = require('./helper');

require('dash-assert');

describe('routes/versions', function() {
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
      environments: ['production']
    };

    this.virtualApp = {
      appId: shortid.generate(),
      url: 'http://test.apphost.com'
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        organization: self.organization,
        virtualApp: self.virtualApp
      };

      next();
    });

    this.orgId = shortid.generate();

    this.server.settings.database = this.database = {
      createVersion: sinon.spy(function(data, callback) {
        callback(null, data);
      }),
      deleteVersion: sinon.spy(function(appId, callback) {
        callback(null);
      }),
      nextVersionNum: sinon.spy(function(appId, callback) {
        callback(null, 2);
      }),
      updateVersion: sinon.spy(function(versionData, callback) {
        callback(null, versionData);
      })
    };

    this.server.settings.virtualAppRegistry = this.virtualAppRegistry = {
      getById: function(appId, opts, callback) {
        callback(null, _.find(self.appRegistry, {appId: appId}));
      },
      getByName: function(name, opts, callback) {
        callback(null, _.find(self.appRegistry, {name: name}));
      },
      flushApp: sinon.spy(function(app) {
      })
    };

    this.server.settings.deployments = this.deployments = {
      deleteAllVersions: sinon.spy(function(appId, callback) {
        callback();
      })
    };

    // Register middleware for handling the appId parameter
    this.server.use(versionsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('POST /', function() {
    it('creates new version', function(done) {
      supertest(this.server)
        .post('/')
        .send({})
        .expect(201)
        .expect(function(res) {
          assert.ok(self.database.createVersion.called);

          assert.isMatch(res.body, {
            appId: self.virtualApp.appId,
            versionNum: 2,
            name: 'v2',
            active: false
          });

          assert.isString(res.body.versionId);

          // assert.equal(res.body.previewUrl, self.virtualApp.url + "?_version=" + versionData.versionId);
        })
        .end(done);
    });
  });

  describe('PUT /:versionId/activate', function() {
    it('activates version', function(done) {
      var versionId = shortid.generate();
      supertest(this.server)
        .put('/' + versionId + '/activate')
        .expect(200)
        .expect(function(res) {
          assert.ok(self.database.updateVersion.calledWith(
            sinon.match({
              appId: self.virtualApp.appId,
              versionId: versionId
            })));

          assert.equal(res.body.previewUrl, self.virtualApp.url + '?_version=' + versionId);
        })
        .end(done);
    });

    it('direct all traffic to new version', function(done) {
      var versionId = shortid.generate();

      this.database.updateTrafficRules = sinon.spy(function(appId, env, rules, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .put('/' + versionId + '/activate')
        .send({forceAllTrafficToNewVersion: true})
        .expect(200)
        .expect(function(res) {
          assert.ok(self.database.updateVersion.called);
          assert.isTrue(self.database.updateTrafficRules.calledWith(
            self.virtualApp.appId,
            self.organization.environments[0],
            [{versionId: versionId, rule:'*'}]));

          assert.ok(self.virtualAppRegistry.flushApp.calledWith(
            sinon.match({appId: self.virtualApp.appId})));

          assert.equal(res.body.previewUrl, self.virtualApp.url);
        })
        .end(done);
    });

    it('no environments configured', function(done) {
      var versionId = shortid.generate();
      this.organization.environments = null;

      supertest(this.server)
        .put('/' + versionId + '/activate')
        .send({versionId: shortid.generate()})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'noEnvironmentsExist');
        })
        .end(done);
    });
  });

  describe('GET /:versionId', function() {
    it('returns version', function(done) {
      var versionId = shortid.generate();
      this.database.getVersion = sinon.spy(function(appId, versionId, callback) {
        callback(null, {versionId: versionId});
      });

      supertest(this.server)
        .get('/' + versionId)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getVersion.calledWith(self.virtualApp.appId, versionId));
          assert.equal(res.body.versionId, versionId);
        })
        .end(done);
    });

    it('returns 404 for missing version', function(done) {
      this.database.getVersion = sinon.spy(function(appId, versionId, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .get('/' + shortid.generate())
        .expect(404)
        .expect(function(res) {
          assert.equal(res.body.code, 'versionNotFound');
        })
        .end(done);
    });
  });

  describe('GET /', function() {
    it('lists versions', function(done) {
      var dbVersions = _.times(3, function(i) {
        return {
          appId: self.virtualApp.appId,
          versionId: shortid.generate(),
          versionNum: i + 1,
          userId: i.toString()
        };
      });

      _.extend(this.database, {
        listVersions: sinon.spy(function(appId, limit, callback) {
          callback(null, dbVersions);
        }),
        getUserInfo: sinon.spy(function(userIds, callback) {
          var userInfo = {};
          _.times(3, function(i) {
            userInfo[i.toString()] = {
              username: 'user' + (i+1)
            }
          });

          callback(null, userInfo);
        })
      });

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(3, res.body.length);
          assert.deepEqual(_.map(res.body, 'username'), ['user3', 'user2', 'user1']);
          assert.isTrue(self.database.listVersions.calledWith(self.virtualApp.appId));
          assert.noDifferences(self.database.getUserInfo.args[0][0], _.map(dbVersions, 'userId'));
        })
        .end(done);
    });
  });

  describe('PUT /:versionId', function() {
    it('updates version name and message', function(done) {
      var versionData = {
        versionId: shortid.generate(),
        name: '1.0.0',
        message: "version message",
        versionNum: 5 // This should not get updated
      };

      self.database.updateVersion = sinon.spy(function(versionData, callback) {
        callback(null, versionData);
      });

      supertest(this.server)
        .put('/' + versionData.versionId)
        .send(versionData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.updateVersion.calledWith(_.omit(versionData, 'versionNum')));
        })
        .end(done);
    });
  });

  describe('DELETE /:versionId', function() {
    it('deletes version', function(done) {
      var versionId = shortid.generate();

      _.extend(this.database, {
        getVersion: sinon.spy(function(appId, versionId, callback) {
          callback(null, {versionId: versionId})
        }),
        deleteVersion: sinon.spy(function(appId, versionId, callback) {
          callback(null, null);
        })
      });

      this.server.settings.deployments = {
        deleteVersion: sinon.spy(function(appId, versionId, cb) {
          cb(null);
        })
      };

      supertest(this.server)
        .delete('/' + versionId)
        .expect(204)
        .expect(function(res) {
          assert.isTrue(self.database.getVersion.calledWith(self.virtualApp.appId, versionId));
          assert.isTrue(self.database.deleteVersion.calledWith(self.virtualApp.appId, versionId));
          assert.isTrue(self.server.settings.deployments.deleteVersion.calledWith(self.virtualApp.appId, versionId));
        })
        .end(done);
    });
  });

  describe('POST /:versionId/deploy', function() {
    it('deploys file', function(done) {
      var versionId = shortid.generate();

      this.deployments.deployFile = sinon.spy(function(appId, versionId, fileInfo, callback) {
        callback(null);
      });

      var testFile = path.resolve(__dirname, './fixtures/lorum-ipsum.html');

      var fileSize = fs.statSync(testFile).size;
      debugger;
      supertest(this.server)
        .post('/' + versionId + "/deploy/html/lorum-ipsum.html")
        .set('Content-Length', fileSize)
        .send(fs.readFileSync(testFile).toString())
        .expect(201)
        .expect(function(res) {
          assert.isTrue(self.deployments.deployFile.calledWith(self.virtualApp.appId, versionId));
          assert.equal(self.deployments.deployFile.args[0][2].size, fileSize);
          assert.equal(self.deployments.deployFile.args[0][2].path, "html/lorum-ipsum.html");
          assert.equal(res.body.key, 'html/lorum-ipsum.html');
        })
        .end(done);
    });
  });
});
