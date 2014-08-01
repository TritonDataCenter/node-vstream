var assert = require('assert');
var fs = require('fs');
var stream = require('stream');
var vstream = require('../lib/vstream');

/*
 * Read the contents of /usr/bin/more and direct it to /dev/null.
 */
var instream, passthru, outstream;
instream = vstream.wrapStream(fs.createReadStream('/usr/bin/more'), 'source');
passthru = vstream.wrapStream(new stream.PassThrough(), 'passthru');
outstream = vstream.wrapStream(fs.createWriteStream('/dev/null'), 'devnull');

instream.pipe(passthru);
passthru.pipe(outstream);

instream.on('data', report);
outstream.on('finish', report);

function report()
{
	var head = outstream.vsHead();
	assert.ok(head == instream);
	head.vsWalk(function (s) { s.vsDumpDebug(process.stdout); });
	console.error('-----');
}
