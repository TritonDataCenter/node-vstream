var assert = require('assert');
var stream = require('stream');
var vstream = require('../lib/vstream');

var s1, s2, pipe, done;

s1 = new stream.PassThrough();
s2 = new stream.PassThrough();
pipe = new vstream.PipelineStream({ 'streams': [ s1, s2 ] });
pipe.write('test string');
pipe.end();
pipe.on('data', function (chunk) {
	assert.ok(!done);
	done = true;
	assert.equal(chunk, 'test string');
	console.log(chunk.toString('utf8'));
});
pipe.on('end', function () { assert.ok(done); });
process.on('exit', function () { assert.ok(done); });
