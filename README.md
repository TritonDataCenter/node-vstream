# node-vstream: instrumented streams

When working with Node streams, particularly object-mode streams, it's often
helpful to be able to inspect a pipeline.  This module instruments objects to
provide:

**For all objects**:

* a name: used in debug output and especially useful for data pipelines
* custom counters: create your own counters for events of interest like
  errors, requests handled, messages sent, or the like
* custom warnings: Error objects that are counted, forwarded to subscribers, but
  otherwise ignored

**For all streams**:

* forward and back pointers: vstream watches `pipe` events and records upstreams
  and downstreams.  You can walk to the head of a pipeline and iterate
  downstream streams.
* debug methods to dump stream state, including high watermarks and data
  buffered on the upstream and downstream sides

**For object-mode transform streams**:

* automatic counters for inputs processed and outputs emitted
* provenance: history information for objects passed through the pipeline (so
  you can report errors with precise information, like "object X from line N")

## Usage

### Instrumenting a simple pipeline

You can instrument one or more regular Node streams by calling
`vstream.wrapStream` on them.  wrapStream returns the same stream, but attaches
a few new functions (and private properties).  Here's a simple pipeline that
reads data from "/usr/bin/more", sends it through a pass-through stream, and
then writes it to "/dev/null":

```javascript
var instream, passthru, outstream;
instream = vstream.wrapStream(fs.createReadStream('/usr/bin/more'), 'source');
passthru = vstream.wrapStream(new stream.PassThrough(), 'passthru');
outstream = vstream.wrapStream(fs.createWriteStream('/dev/null'), 'devnull');

instream.pipe(passthru);
passthru.pipe(outstream);
```

As an example, we'll attach a listener to each `'data'` event that dumps the
debug information from each stream in the pipeline.  The debug information
includes the stream's name, what kind of stream it is (readable, writable, or
duplex), the amount of data buffered, and the high watermark.  We'll also dump
this when the pipeline finishes (when the last stream emits `'finish'`).

```javascript
instream.on('data', report);
outstream.on('finish', report);

function report()
{
	var head = outstream.vsHead();
	assert.ok(head == instream);
	head.vsWalk(function (stream) { stream.vsDumpDebug(process.stdout); });
	console.error('-----');
}
```

On my system, this prints:

```
source               (readable, rbuf: 0/65536)
passthru             (duplex, wbuf: 0/16384, rbuf: 0/16384)
devnull              (writable, wbuf: 65536/16384)
-----
source               (readable, rbuf: 0/65536)
passthru             (duplex, wbuf: 0/16384, rbuf: 65536/16384)
devnull              (writable, wbuf: 65536/16384)
-----
source               (readable, rbuf: 0/65536)
passthru             (duplex, wbuf: 0/16384, rbuf: 6640/16384)
devnull              (writable, wbuf: 65536/16384)
-----
source               (readable, rbuf: 0/65536)
passthru             (duplex, wbuf: 0/16384, rbuf: 0/16384)
devnull              (writable, wbuf: 0/16384)
-----
```

"source", "passthrough", and "devnull" are the names we gave these streams,
which are readable, duplex, and writable, respectively.  Notice that the default
high watermark for a readable file stream ("source") is 64K, or 65536 bytes.
The default high watermarks for the PassThrough and the writable file streams
are 16K, or 16384 bytes.

Seeing this while writing this example, I picked /usr/bin/more because it's
just over 128K.  On my system, this causes Node to read two full 64K chunks,
plus one smaller chunk.  This makes for an interesting example:

* When we get the first `data` event (the first printout above), the data has
  already been written to the PassThrough, which wrote it downstream to the
  /dev/null stream.  The /dev/null stream has it all buffered, since it hasn't
  had a chance to do I/O yet.  The /dev/null stream buffered all 64K, not just
  16K, presumably because it came in as one chunk.  (Remember that the high
  watermark is a guideline, but it's possible to buffer more bytes than that --
  as we see here.)
* When we get the second `data` event (the second printout above), the data is
  still buffered on the /dev/null stream and has backed up to the PassThrough.
  For whatever reason, the /dev/null stream isn't keeping up with the source
  read stream, and we can see the buffering here.  This is flow control
  (backpressure) in action.
* At this point, if the /dev/null stream were totally blocked, we'd expect the
  PassThrough stream to buffer at least 16K on the *write* side as well, then
  the source would back up on its readable side, and then we'd stop reading from
  the original file.
* This doesn't happen, because by the time we get the third `data` event, the
  /dev/null stream must have written some data out, because the PassThrough has
  fewer bytes buffered.
* When the pipeline has finished (the last printout), there are no bytes
  buffered anywhere.

The example's pretty trivial, but you can learn a lot about Node streams by
understanding what's going on at each stage.  Of course, the real point of
`vstream` isn't to demonstrate this, but to help debug situations where things
*aren't* going as expected.  The debug information can help you understand where
data has buffered up way more than you wanted (usually a memory leak) or where
the pipeline's plugged up.


### Instrumenting a transform stream

When you wrap Transform streams, vstream modifies `_transform`, `_flush`, and
`push` to keep track of which outputs were generated by which inputs.  You can
use this to generate useful error messages when you encounter bad input.  Here's
a little program that reads /etc/passwd and emits a warning when it finds the
"nobody" user:

```javascript
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

mystream.on('warn', function (context, kind, error) {
	console.log('kind:    %s', kind);
	console.log('error:   %s', error.message);
	console.log('context: %s', context.label());

	mystream.vsHead().vsWalk(function (s) {
		s.vsDumpDebug(process.stdout);
	});
});
```

When I run this on OS X Mavericks, I get:

```
kind:    nfoundusers
error:   found "nobody"
context: UserSearcher input 11 from LineStream input 1: value 'nobody:*:-2:-2:Unprivileged User:/var/empty:/usr/bin/false'
source               (readable, rbuf: 0/65536)
LineStream           (duplex, wbuf: 1/16384, rbuf: 0/16384)
    ninputs:         1
    noutputs:        11
UserSearcher         (duplex, wbuf: 1/16384, rbuf: 1/16384)
    nfoundusers:     1
    ninputs:         11
    noutputs:        1
```

The context for each warning keeps track of the history through all
vstream-wrapped Transform streams.  vstream also bumps a counter for each
warning, which is why "nfoundusers" is 1.


## Design notes

A key design principle for this module is that it should be possible to
usefully instrument streams that were not written to support this module.  Some
features (like bumping custom counters or emitting warnings) may require adding
code, but basic features should work without special support, and instrumenting
a stream should not break existing functionality.  That's why this module is
implemented (somewhat regrettably) by attaching properties to existing objects
rather than requiring users to inherit from a custom class.

Public properties attached to instrumented objects use camel case and start with
a "vs" prefix to avoid colliding with other properties a user might be using.
Similarly, private properties use snake case with a "vs\_" prefix.


## Caveats

### Memory usage

vstream tracks pipes to add upstream and downstream references, but it does not
track unpipes to remove these references.  That's because streams are unpiped
when the end-of-stream is reached, but this is often when it's most useful to
debug the pipeline, so it's useful to keep these references around.  As a
result, if you keep a reference to any stream in the pipeline, you'll likely
have references to the whole pipeline.  If you implement a stream that makes
heavy use of pipe and unpipe, you may end up referencing more memory than you'd
expect.  In all cases, once all references to all streams in the pipeline have
been removed, all of these objects can be garbage collected.

### API stability

The stream debugging information relies on accessing the internal Node state of
the stream, which is not guaranteed to remain stable across Node releases.  It's
possible that Node upgrades could break this behavior.  If you notice incorrect
output or unexpected crashes, please file an issue.


## Contributions

Contributions welcome, and should be 'make prepush' clean.  The prepush checks
use [javascriptlint](https://github.com/davepacheco/javascriptlint) and
[jsstyle](https://github.com/davepacheco/jsstyle).
