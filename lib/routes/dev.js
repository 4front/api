var express = require('express');
var _ = require('lodash');
var through = require('through2');
var urljoin = require('url-join');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:api:dev');

module.exports = function(options) {
  var router = express.Router();

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

    var maxAge = getCacheMaxAge(req);
    var cacheKey = getCacheKey(req, '_manifest');

    debug("writing manifest to cache with key %s", cacheKey);
    req.app.settings.cache.setex(cacheKey, maxAge, JSON.stringify(manifest));
    res.status(201).json({key: cacheKey});
  });

  // Invoked by the CLI when a request is made for a file that doesn't
  // exist locally. Ensure that there is not a copy of the same file
  // in the cache.
  router.post('/:appId/notfound/*', function(req, res) {
    var filePath = req.path.split('/').slice(3).join('/');

    debug('uploading file %s to dev sandbox', filePath);

    // Create a cacheKey consisting of the userId, appId, and the filePath
    var cacheKey = getCacheKey(req, filePath);

    req.app.settings.cache.del(cacheKey);
    req.app.settings.cache.del(cacheKey + '/hash');
    res.status(201).end();
  });

  router.post("/:appId/upload/*", function(req, res, next) {
    var filePath = req.path.split('/').slice(3).join('/');

    // Chop off any leading slash so we don't end up with a double slash in
    // the cacheKey
    debug('uploading file %s to dev sandbox', filePath);

    // Create a cacheKey consisting of the userId, appId, and the filePath
    var cacheKey = getCacheKey(req, filePath);

    var fileStream = req.pipe(through(function(chunk, enc, callback) {
      this.push(chunk);
      callback();
    }));

    var maxAge = getCacheMaxAge(req);
    var hash = req.header('file-hash');

    debug('piping uploaded page to cache with key %s and hash %s', cacheKey, hash);

    req.app.settings.cache.setex(cacheKey + '/hash', maxAge, hash);

    fileStream.pipe(req.app.settings.cache.writeStream(cacheKey, maxAge))
      .on('error', function(err) {
        return next(err);
      })
      .on('finish', function() {
        // Update the TTL on the manifest whenever a new file is uploaded
        var manifestCacheKey = getCacheKey(req, '_manifest');
        req.app.settings.cache.expire(manifestCacheKey, getCacheMaxAge(req));

        res.status(201).json({key: cacheKey});
      });
  });

  function getCacheMaxAge(req) {
    return req.app.settings.sandboxCacheMaxAge || (30 * 60);
  }

  function getCacheKey(req, filePath) {
    return urljoin(req.ext.user.userId, req.ext.virtualApp.appId, filePath);
  }

  return router;
};
