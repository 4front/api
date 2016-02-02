var mockery = require('mockery');
var fs = require('fs');
var path = require('path');

mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
});

mockery.registerMock('whois', {
  lookup: function(domainName, callback) {
    var filename;
    if (domainName.startsWith('missing-')) {
      filename = 'missing';
    } else if (domainName.startsWith('notfound-')) {
      filename = 'notfound';
    } else {
      filename = domainName;
    }

    fs.readFile(path.join(__dirname, './fixtures/whois-' + filename + '.txt'), function(err, data) {
      callback(null, data.toString());
    });
  }
});
