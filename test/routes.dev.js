var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var sbuff = require('simple-bufferstream');
var memoryCache = require('memory-cache-stream');
var debug = require('debug')('4front-api:test');
var devRoute = require('../lib/routes/dev');
var helper = require('./helper');

require('dash-assert');

describe('routes/dev', function() {
  var self;

  beforeEach(function() {
    self = this;

    var memoryCache = memoryCache();

    this.server = express();
    this.server.settings.cache = this.cache = {
      setex: sinon.spy(function(key, ttl, value) {
        memoryCache.setex(key, ttl, value);
      }),
      writeStream: sinon.spy(function(key, ttl) {
        return memoryCache.writeStream(key, ttl);
      })
    };

    this.server.settings.virtualAppRegistry = {
      getById: function(appId, opts, callback) {
        if (_.isFunction(opts))
          callback = opts;

        callback(null, {appId: appId, orgId: '1'});
      }
    };

    this.server.settings.database = {
      getOrganization: function(orgId, cb) {
        cb(null, {orgId: orgId});
      },
      getOrgMember: function(orgId, userId, cb) {
        cb(null, {orgId: orgId, userId: userId, role: 'admin'});
      }
    };

    this.user = {
      userId: shortid.generate(),
      username: 'tester',
      secretKey: shortid.generate()
    };

    this.virtualApp = {
      appId: shortid.generate(),
      url: 'http://test.apphost.com'
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        virtualApp: self.virtualApp
      };

      next();
    });

    // Register middleware for handling the appId parameter
    this.server.use(devRoute());

    this.server.use(helper.errorHandler);
  });

  describe('POST /upload', function() {
    it('upload a file to the sandbox', function(done) {

      var fileContents = "<html>blog</html>";
      var lastModified = new Date().getTime();
      supertest(this.server)
        .post('/' + self.virtualApp.appId + '/upload/pages/blog.html')
        .set('Last-Modified', lastModified.toString())
        .send(fileContents)
        .expect(201)
        .end(function(err) {
          var cacheKey = self.user.userId + '/' + self.virtualApp.appId + '/pages/blog.html';

          // Assert that both the file contents and the lastModified time
          // are written to the cache.
          assert.ok(self.cache.setex.calledWith(cacheKey, sinon.match.number, fileContents));
          assert.ok(self.cache.setex.calledWith(cacheKey + '/mtime', sinon.match.number, lastModified.toString()));
          done();
        });
    });
  });

  describe('POST /manifest', function() {
    it('uploads manifest to the sandbox', function(done) {
      var manifest = {
        router: [
          {
            module: 'html-page',
            options: {}
          }
        ]
      };

      supertest(this.server)
        .post('/' + this.virtualApp.appId + '/manifest')
        .send(manifest)
        .expect(201)
        .end(function(res) {
          var cacheKey = self.user.userId + '/' + self.virtualApp.appId + '/_manifest';

          assert.ok(self.cache.setex.calledWith(cacheKey, sinon.match.number, JSON.stringify(manifest)));
          done();

          // self.server.settings.cache.get(cacheKey, function(err, contents) {
          //   assert.deepEqual(JSON.parse(contents), manifest);
          //
          //   done();
          // });
        });
    });
  });
});
