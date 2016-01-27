var assert = require('assert');
var whois = require('../lib/whois');

require('dash-assert');

describe('whois', function() {
  beforeEach(function() {
    this.timeout(5000);
  });

  it('returns record', function(done) {
    whois('github.com', function(err, record) {
      if (err) return done(err);

      assert.equal(record.domainName, 'github.com');
      assert.equal(record.registrantEmail, 'hostmaster@github.com');
      assert.equal(record.adminEmail, 'hostmaster@github.com');
      assert.equal(record.techEmail, 'hostmaster@github.com');
      assert.equal(record.registrantCountry, 'US');

      done();
    });
  });

  it('returns null for missing whois record', function(done) {
    whois('24kwj45345asdf.net', function(err, record) {
      if (err) return done(err);

      assert.isNull(record);
      done();
    });
  });
});
