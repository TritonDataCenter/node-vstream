var assert = require('assert');
var fs = require('fs');
var stream = require('stream');
var lstream = require('lstream');
var vstream = require('../lib/vstream');

var instream, linestream, mystream;
var user = 'nobody';

/*
 * Read the contents of /etc/passwd and chunk it into lines.
 */
instream = vstream.wrapStream(fs.createReadStream('/etc/passwd'), 'source');
linestream = vstream.wrapTransform(new lstream());

/*
 * Pipe the lines into a stream that looks for the "nobody" user and emits a
 * warning, which will include the line number.
 */
mystream = new stream.Transform({ 'objectMode': true });
mystream._transform = function myTransform(line, _, callback) {
	if (line.substr(0, user.length + 1) == user + ':') {
		this.push(user);
		this.vsWarn(new Error('found "' + user + '"'), 'nfoundusers');
	}

	callback();
};
mystream = vstream.wrapTransform(mystream, 'UserSearcher');

instream.pipe(linestream);
linestream.pipe(mystream);

/*
 * We can subscribe to "warn" events to see whenever our stream emits a
 * "warning".  With each event we get:
 *
 *     context  The provenance (history) information of the *input* that
 *     		generated the warning.  In this case, that's the line number we
 *     		were reading.
 *
 *     kind	A string describing the general class of warning.  vstream bumps
 *     		a counter of the number of warnings of each kind, even if there
 *     		are no listeners for the "warn" event.
 *
 *     error	The actual error emitted with the warning, which you can use to
 *     		get the message and the stack trace that generated the warning.
 */
mystream.on('warn', function (context, kind, error) {
	console.log('kind:    %s', kind);
	console.log('error:   %s', error.message);
	console.log('context: %s', context.label());

	mystream.vsHead().vsWalk(function (s) {
		s.vsDumpDebug(process.stdout);
	});
});
