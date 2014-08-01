/*
 * vstream.js: instrumentable streams mix-ins
 */

var mod_assertplus = require('assert-plus');
var mod_util = require('util');

var sprintf = require('extsprintf').sprintf;


/* High-level interfaces for wrapping existing streams and transforms. */
exports.wrapStream = wrapStream;
exports.wrapTransform = wrapTransform;

/* Low-level interfaces for instrumenting objects, streams, and transforms */
exports.instrumentObject = instrumentObject;
exports.instrumentStream = instrumentStream;
exports.instrumentTransform = instrumentTransform;

/* Other classes */
exports.PipelineStream = require('./stream-pipeline');


/*
 * Returns true iff the given object has been initialized for this module.
 */
function isInstrumented(obj)
{
	return (typeof (obj.vs_name) == 'string');
}

/*
 * Convenience function for instrumenting a stream.
 */
function wrapStream(stream, options)
{
	if (options === undefined)
		options = { 'name': stream.constructor.name };
	else if (typeof (options) == 'string')
		options = { 'name': options };
	instrumentObject(stream, options);
	instrumentStream(stream);
	return (stream);
}

/*
 * Convenience function for instrumenting a Transform stream.
 */
function wrapTransform(stream, options)
{
	stream = wrapStream(stream, options);
	instrumentTransform(stream);
	return (stream);
}


/*
 * Instrument an arbitrary JavaScript object.  Instrumenting an object gives it
 * an immutable human-readable label and a set of named counters, and it's a
 * prerequisite for more sophisticated instrumentations used for Streams and
 * Transform streams in particular.
 *
 * The general pattern in this module is that private fields are added in the
 * vs_* namespace (snake_cased, conventional with C-style fields), and public
 * methods are added in the vs* namespace (camel-cased, conventional with the
 * rest of JavaScript)
 */
function instrumentObject(obj, args)
{
	mod_assertplus.object(obj, 'obj');
	mod_assertplus.ok(!isInstrumented(obj), 'object already instrumented');
	mod_assertplus.object(args, 'args');
	mod_assertplus.string(args.name, 'args.name');

	/* private fields */
	obj.vs_name = args.name;	/* label for display to developers */
	obj.vs_counters = {};		/* named, numeric counters */
	obj.vs_context = null;		/* current context (general purpose) */

	/* public methods */
	obj.vsName = vsName;			/* get name */
	obj.vsCounters = vsCounters;		/* get counter values */
	obj.vsCounterBump = vsCounterBump;	/* bump named counter */
	obj.vsWarn = vsWarn;			/* emit warning (counted) */
}

function vsCounterBump(name)
{
	if (!this.vs_counters.hasOwnProperty(name))
		this.vs_counters[name] = 0;
	this.vs_counters[name]++;
}

function vsName()
{
	return (this.vs_name);
}

function vsCounters()
{
	return (this.vs_counters);
}

/*
 * Warnings are non-fatal errors classified by "kind".  The caller can choose to
 * listen for them, in which case additional context is provided if available.
 * Either way, we bump a "kind"-specific counter.
 */
function vsWarn(err, kind)
{
	var context;

	mod_assertplus.ok(isInstrumented(this),
	    'vsWarn() on uninstrumented stream');
	mod_assertplus.ok(err instanceof Error,
	    'vsWarn() called without error');
	mod_assertplus.string(kind);

	context = this.vs_context === null ?
	    null : this.vs_context.withSource(this);

	this.vsCounterBump(kind);
	this.emit('warn', context, kind, err);
}


/*
 * Instruments a stream.  This adds forward and back pointers on pipe().
 */
function instrumentStream(stream)
{
	mod_assertplus.ok(isInstrumented(stream),
	    'attempted to instrument pipeline ops on uninstrumented stream');

	/* private fields */
	stream.vs_upstreams = [];	/* upstream streams */
	stream.vs_downstreams = [];	/* downstream streams */

	/*
	 * Public methods for accessing and manipulating linkages directly.
	 * The vsRecord* functions are useful for cases that pipe() doesn't
	 * handle (e.g., a multiplexer).
	 */
	stream.vsHead = vsHead;
	stream.vsRecordPipe = vsRecordPipe;
	stream.vsRecordUnipe = vsRecordUnpipe;
	stream.vsWalk = vsWalk;
	stream.vsDumpCounters = vsDumpCounters;
	stream.vsDumpDebug = vsDumpDebug;

	/*
	 * Add a pipe() handler to this stream so that when something is piped
	 * into it, we automatically update the upstream/downstream linkages of
	 * both streams.  Note that we don't add an unpipe() handler to remove
	 * this linkage because it's almost always more useful to keep track of
	 * past pipes.  Specifically, Node unpipes the stream when its
	 * downstream emits 'finish' or 'close', but it's often quite useful to
	 * keep these linkages so that you can inspect a pipeline after data
	 * flow has ended.
	 */
	stream.on('pipe', function (source) {
		if (!isInstrumented(source)) {
			mod_assertplus.ok(
			    !source.hasOwnProperty('vs_downstreams'));
			instrumentObject(source,
			    { 'name': source.constructor.name });
			instrumentStream(source);
		}

		source.vsRecordPipe(stream);
	});
}

/*
 * Record an upstream-downstream relationship that isn't handled by pipe().
 */
function vsRecordPipe(downstream)
{
	if (!isInstrumented(downstream)) {
		mod_assertplus.ok(
		    !downstream.hasOwnProperty('vs_upstreams'));
		instrumentObject(downstream,
		    { 'name': downstream.constructor.name });
		instrumentStream(downstream);
	}

	this.vs_downstreams.push(downstream);
	downstream.vs_upstreams.push(this);
}

/*
 * Remove a linkage created with vsRecordPipe.
 */
function vsRecordUnpipe(downstream)
{
	/*
	 * This is O(N), but N should be small, and this is not supposed to be
	 * a hot path.
	 */
	var i, j;

	for (i = 0; i < this.vs_downstreams.length; i++) {
		if (downstream == this.vs_downstreams[i])
			break;
	}

	mod_assertplus.ok(i < this.vs_downstreams.length,
	    'attempted to remove downstream that\'s not registered');

	for (j = 0; j < downstream.vs_upstreams.length; j++) {
		if (this == downstream.vs_upstreams[j])
			break;
	}

	mod_assertplus.ok(j < downstream.vs_upstreams.length,
	    'attempted to remove upstream that\'s not registered');

	this.vs_downstreams.splice(i, 1);
	downstream.vs_upstreams.splice(j, 1);
}

/*
 * Given a stream, walk upstream until encountering a pipeline with no more
 * upstreams.  Remember that streams can have multiple upstreams (as when you
 * pipe multiple streams into one stream), so there can be multiple possible
 * heads.  Any of these may be returned by this function.
 */
function vsHead()
{
	var stream;

	mod_assertplus.ok(isInstrumented(this));
	mod_assertplus.ok(Array.isArray(this.vs_upstreams),
	    'stream has not been instrumented');

	stream = this;
	while (stream.hasOwnProperty('vs_upstreams') &&
	    stream.vs_upstreams.length > 0)
		stream = stream.vs_upstreams[0];

	return (stream);
}

/*
 * Invoke "func" for each downstream stream in a pipeline starting at "stream".
 * "func" will be invoked on "stream".  Remember that streams can have multiple
 * downstreams (as when you pipe a stream to multiple other streams), so there
 * can be multiple possible pipelines.  Any of these pipelines may be iterated
 * by this function.
 */
function vsWalk(func, depth)
{
	var stream;

	mod_assertplus.ok(Array.isArray(this.vs_downstreams),
	    'stream has not been instrumented');

	if (!depth)
		depth = 0;

	stream = this;
	while (stream !== null) {
		func(stream, depth);

		/*
		 * XXX pipeline stream needs to move into this package to avoid
		 * gross interface violations.
		 * XXX doesn't handle nested pipelines
		 */
		if (stream !== null && stream.ps_streams !== undefined) {
			stream.ps_streams.forEach(
			    function (s) { func(s, depth + 1); });
		}

		stream = stream.hasOwnProperty('vs_downstreams') &&
		    stream.vs_downstreams.length > 0 ?
		    stream.vs_downstreams[0] : null;
	}
}

/*
 * Dump debug information about a stream.
 */
function vsDumpDebug(outstream, indentlen, options)
{
	var i, kind, name, comments, counters, fmt;
	var stream = this;
	var indent = '';

	if (indentlen) {
		for (i = 0; i < indentlen; i++)
			indent += '    ';
	}

	if (!options)
		options = {
		    'showKind': true,
		    'showBufferInfo': true
		};

	comments = [];

	if (options.showKind) {
		if (this._readableState) {
			if (this._writableState)
				kind = 'duplex';
			else
				kind = 'readable';
		} else if (this._writableState) {
			kind = 'writable';
		} else {
			kind = 'unknown';
		}
		comments.push(kind);
	}

	mod_assertplus.ok(isInstrumented(this));
	name = this.vsName();

	if (options.showBufferInfo) {
		if (this._writableState) {
			comments.push(sprintf('wbuf: %s/%s',
			    this._writableState.length,
			    this._writableState.highWaterMark));
		}

		if (this._readableState) {
			comments.push(sprintf('rbuf: %s/%s',
			    this._readableState.length,
			    this._readableState.highWaterMark));
		}
	}

	outstream.write(indent);
	fmt = 20 - indent.length < 10 ? '%s' :
	    '%-' + (20 - indent.length) + 's';
	outstream.write(sprintf(fmt, name));
	if (comments.length > 0)
		outstream.write(sprintf(' (%s)', comments.join(', ')));
	outstream.write('\n');

	if (this.hasOwnProperty('vs_counters')) {
		counters = Object.keys(this.vs_counters).sort();
		counters.forEach(function (c) {
			outstream.write(sprintf('%s    %-16s %d\n',
			    indent, c + ':', stream.vs_counters[c]));
		});
	}
}

/*
 * Given a stream, dump stream stats, one per line.  Streams with no counters
 * will produce no output.
 */
function vsDumpCounters(outstream)
{
	var name, counters, counternames;

	name = this.vsName();
	counters = this.vsCounters();
	counternames = Object.keys(counters).sort();
	counternames.forEach(function (c) {
		outstream.write(sprintf('%-18s %-14s %6d\n',
		    name, c + ':', counters[c]));
	});
}

/*
 * Instruments an object-mode Transform stream.  This modifies the stream's
 * _transform() method so that it accepts values wrapped in ProvenanceValue
 * objects and passes the wrapped value to the underlying _transform() method.
 * On the output side, this stream outputs the unwrapped values by default, but
 * if the stream is piped to another instrumented Transform, then the
 * ProvenanceValues are passed directly.
 *
 * The net result of this is that you can take a bunch of traditional Node
 * Transform streams (which know nothing about this framework), instrument them,
 * pipe them together, and they will keep track of the history of each value as
 * it moves through the pipeline.  This is useful for data-processing pipelines
 * in order to report an error as having occured on "line 10" of the input, even
 * if the error only happens after several transformations, and even if those
 * transformations are not 1-to-1.  If you ever pipe to something that's not an
 * instrumented Transform, the provenance information is lost but the stream
 * continues to function.
 */
function instrumentTransform(transform)
{
	mod_assertplus.ok(isInstrumented(transform),
	    'transform stream is not an instrumented object');

	/* overrides for fields defined by Node */
	transform.vs_realtransform = transform._transform;
	transform._transform = vsTransform;
	transform.vs_realpush = transform.push;
	transform.push = vsPush;

	if (transform._flush) {
		transform.vs_realflush = transform._flush;
		transform._flush = vsFlush;
	}

	/*
	 * Marshaling mode: this determines whether we wrap values emitted by
	 * the underlying _transform() function in a ProvenanceValue object.  We
	 * want to do this if the reader is another instrumented Transform
	 * object.  That's how we propagate provenance information.  But we must
	 * not do this if the reader is anything else because they will be
	 * expecting the raw value.
	 *
	 * Our marshalmode starts out as "unspecified".  If we're piped to
	 * another instrumented Transform, that instance will update this value
	 * to 'marshal'.  When we emit the first datum, if marshalmode is still
	 * 'unspecified', we'll commit to 'nomarshal'.  This algorithm handles
	 * simple pipelines of all kinds of streams as well as callers using
	 * read() directly or listening for 'data' events.  There are some other
	 * cases, including where this stream is piped to an instrumented
	 * Transform *and* another stream.  These are considered unlikely.
	 */
	transform.vs_marshalmode = 'unspecified';
	transform.on('pipe', function (upstream) {
		/* XXX embedding knowledge of PipelineStream */
		if (upstream.hasOwnProperty('ps_streams')) {
			upstream = upstream.ps_streams[
			    upstream.ps_streams.length - 1];
		}

		if (upstream.vs_marshalmode == 'unspecified')
			upstream.vs_marshalmode = 'marshal';
	});
}

/*
 * Proxy method for _transform().  This unwraps any existing ProvenanceValue and
 * records the context for any outputs emitted during the call to the underlying
 * transform().  In the future, this is where we could add bunyan log entries
 * or DTrace probes.
 */
function vsTransform(chunk, _, callback)
{
	var self = this;
	var augmented;

	mod_assertplus.ok(isInstrumented(this),
	    'attempted call to vsTransform() on uninstrumented Transform');
	mod_assertplus.ok(this.vs_context === null);

	if (chunk instanceof ProvenanceValue)
		augmented = chunk;
	else
		augmented = new ProvenanceValue(chunk);

	this.vsCounterBump('ninputs');
	this.vs_context = augmented;
	this.vs_realtransform(augmented.pv_value, _, function (err, newchunk) {
		/*
		 * This check is annoying, but it's the only way we can detect
		 * whether someone's doing something with the API that we don't
		 * know how to handle.  We could likely avoid interpreting the
		 * arguments at all and just pass them straight through to the
		 * original callback, but that callback may end up invoking
		 * _transform again without a way for us to know that it
		 * happened, and we'd blow our assertion that vs_context ===
		 * null.  We could also loosen that invariant and just assume
		 * that we're maintaining vs_context correctly, but it's worth
		 * adding a stricter check while it's not too painful.
		 */
		mod_assertplus.ok(arguments.length < 3,
		    '_transform callback passed more arguments than expected');
		mod_assertplus.ok(self.vs_context === augmented);

		if (!err && arguments.length > 1) {
			self.push(newchunk);
			mod_assertplus.ok(self.vs_context === augmented);
		}

		self.vs_context = null;
		callback.apply(null,
		    Array.prototype.slice.call(arguments, 0, 1));
	});
}

/*
 * Proxy method for _flush().  Like vsTransform(), this maintains the current
 * context around the call to the underlying _flush(), and this would be a good
 * place to add bunyan log entries and DTrace probes.
 */
function vsFlush(callback)
{
	var self = this;
	var augmented;

	mod_assertplus.ok(isInstrumented(this),
	    'attempted call to vsFlush() on uninstrumented Transform');
	mod_assertplus.ok(this.vs_context === null);

	augmented = new ProvenanceValue();
	this.vs_context = augmented;
	this.vs_realflush(function () {
		mod_assertplus.ok(self.vs_context === augmented);
		self.vs_context = null;
		callback.apply(null, Array.prototype.slice.call(arguments));
	});
}

/*
 * Proxy method for push().  If we're configured to marshal the raw outputs,
 * this is where we wrap each raw output in a ProvenanceValue derived from the
 * current context.  This is also where we commit to a mrashaling mode if we
 * haven't done so already.  See instrumentTransform() for details.
 */
function vsPush(chunk)
{
	var augmented;

	mod_assertplus.ok(isInstrumented(this),
	    'attempted call to vsPush() on uninstrumented Transform');
	mod_assertplus.ok(chunk === null || this.vs_context !== null);

	if (chunk === null)
		return (this.vs_realpush(null));

	this.vsCounterBump('noutputs');
	if (this.vs_marshalmode == 'unspecified')
		this.vs_marshalmode = 'nomarshal';

	if (this.vs_marshalmode == 'nomarshal') {
		return (this.vs_realpush(chunk));
	} else {
		augmented = this.vs_context.next(chunk, this);
		return (this.vs_realpush(augmented));
	}
}

/*
 * A ProvenanceValue is just a wrapper for a value that keeps track of a stack
 * of provenance information.  Instances of this class are read-only, but all
 * fields are publicly accessible.
 */
function ProvenanceValue(value)
{
	this.pv_value = value;
	this.pv_provenance = [];
}

ProvenanceValue.prototype.next = function (newvalue, source)
{
	var rv;

	mod_assertplus.ok(isInstrumented(source));
	rv = new ProvenanceValue(newvalue);
	rv.pv_provenance = this.pv_provenance.slice(0);
	rv.pv_provenance.push({
	    'pvp_source': source.vs_name,
	    'pvp_input': source.vs_counters['ninputs'] || 0
	});
	return (rv);
};

ProvenanceValue.prototype.withSource = function (source)
{
	return (this.next(this.pv_value, source));
};

ProvenanceValue.prototype.label = function ()
{
	var parts;

	parts = this.pv_provenance.map(function (p) {
		return (p.pvp_source + ' input ' + p.pvp_input);
	}).reverse();

	return (parts.join(' from ') + ': value ' +
	    mod_util.inspect(this.pv_value, false, 4));
};
