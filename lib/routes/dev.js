var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var through = require('through2');
var debug = require('debug')('4front-api:dev');

module.exports = function(options) {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  router.post(/\/upload\/(.*)/, function(req, res, next) {
    // var pathParts = req.originalUrl.split('/');
    var filePath = req.params[0];

    // Chop off any leading slash so we don't end up with a double slash in
    // the cacheKey
    debug('uploading file %s to dev sandbox', filePath);

    // Create a cacheKey consisting of the userId, appId, and the filePath
    var cacheKey = req.ext.user.userId + "/" + req.ext.virtualApp.appId  + "/" + filePath;

    var fileStream = req.pipe(through(function(chunk, enc, callback) {
      this.push(chunk);
      callback();
    }));

    var maxAge = req.app.settings.sandboxCacheMaxAge || (20 * 60);

    debug('piping uploaded page to cache with key %s', cacheKey);

    req.app.settings.cache.setex(cacheKey + '/hash', req.header('File-Hash'), maxAge);

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
