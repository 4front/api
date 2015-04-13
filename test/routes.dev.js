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
    this.server = express();
    this.server.settings.cache = memoryCache();

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

  describe('POST /', function() {
    it('deploy a file to the sandbox', function(done) {

      var fileContents = "<html>blog</html>";
      supertest(this.server)
        .post('/upload/pages/blog.html')
        .send(fileContents)
        .expect(201)
        .end(function(err) {
          var cacheKey = self.virtualApp.appId + '/' + self.user.userId + '/pages/blog.html';

          self.server.settings.cache.get(cacheKey, function(err, contents) {
            assert.equal(fileContents, contents.toString());
            done();
          });
        });
    });
  });
});
