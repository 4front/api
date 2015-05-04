var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var through = require('through2');
var urljoin = require('url-join');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:api:dev');

module.exports = function(options) {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // Register middleware for handling the appId parameter
  router.param('appId', require('../middleware/appid-param')(options));

  // Upload the app manifest to the dev sandbox
  router.post('/:appId/manifest', bodyParser.json(), function(req, res, next) {
    var manifest = req.body;

    // Validate the manifest
    // TODO: Use Joi to define a schema for the manifest and validate against that.
    if (_.isObject(manifest) === false) {
      return next(Error.http(400, "Invalid app manifest"));
    }

    var maxAge = req.app.settings.sandboxCacheMaxAge || (20 * 60);
    var cacheKey = req.ext.user.userId + "/" + req.ext.virtualApp.appId + "/_manifest";

    debug("writing manifest to cache with key %s", cacheKey);
    req.app.settings.cache.setex(cacheKey, maxAge, JSON.stringify(manifest));
    res.status(201).json({key: cacheKey});
  });

  router.post("/:appId/upload/*", function(req, res, next) {
    var filePath = req.path.split('/').slice(3).join('/');

    // Chop off any leading slash so we don't end up with a double slash in
    // the cacheKey
    debug('uploading file %s to dev sandbox', filePath);

    // Create a cacheKey consisting of the userId, appId, and the filePath
    var cacheKey = urljoin(req.ext.user.userId, req.ext.virtualApp.appId, filePath);

    var fileStream = req.pipe(through(function(chunk, enc, callback) {
      this.push(chunk);
      callback();
    }));

    var maxAge = req.app.settings.sandboxCacheMaxAge || (20 * 60);
    var lastModified = req.header('last-modified');

    debug('piping uploaded page to cache with key %s and lastModified %s', cacheKey, lastModified);

    req.app.settings.cache.setex(cacheKey + '/mtime', maxAge, lastModified);

    fileStream.pipe(req.app.settings.cache.writeStream(cacheKey, maxAge))
      .on('error', function(err) {
        return next(err);
      })
      .on('finish', function() {
        res.status(201).json({key: cacheKey});
      });
  });

  return router;
};
