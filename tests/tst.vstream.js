/*
 * Test vstream interfaces.
 */

var mod_assert = require('assert');
var mod_stream = require('stream');
var mod_util = require('util');
var mod_vasync = require('vasync');
var mod_vstream = require('../lib/vstream');

/*
 * Simple Transform class used for testing.  For each input (a string), emits
 * three output strings representing the input's length (in characters), emitted
 * as a string so that this class can be composed.  Flush emits the string
 * 'flush' three times.
 */
function TestTransform()
{
	mod_stream.Transform.call(this, { 'objectMode': true });
}

mod_util.inherits(TestTransform, mod_stream.Transform);

TestTransform.prototype._transform = function (chunk, _, callback)
{
	var self = this;

	if (chunk == 'dropme') {
		this.vsWarn(new Error('explicit drop'), 'explicit');
		callback();
		return;
	}

	self.push(chunk.length.toString());
	setImmediate(function () {
		var i;

		for (i = 0; i < 2; i++)
			self.push(chunk.length.toString());

		callback();
	});
};

TestTransform.prototype._flush = function (callback)
{
	var self = this;
	this.push('flush');

	setImmediate(function () {
		self.push('flush');
		self.push('dropme');
		callback();
	});
};

var count, done;

/*
 * Test a simple instrumented transform stream.  For each input ("h", "he",
 * "hel"), we should get three outputs whose values are the corresponding
 * lengths, represented as strings ("1", "2", "3"), plus three instances of the
 * string "flush".
 *
 * Besides the streams working correctly, these should all have the right
 * provenance information.
 */
function testSimple(_, callback)
{
	var results, t1;

	console.log('test: instrumented transform');
	count = 0;
	results = [];

	t1 = new TestTransform();
	mod_vstream.instrumentObject(t1, { 'name': 't1' });
	mod_vstream.instrumentTransform(t1);
	t1.vs_marshalmode = 'marshal';
	t1.on('data', function (chunk) { results.push(chunk); });
	t1.on('end', function () {
		mod_assert.deepEqual(results, [ {
		    'pv_value': '1',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 1
		    } ]
		}, {
		    'pv_value': '1',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 1
		    } ]
		}, {
		    'pv_value': '1',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 1
		    } ]
		}, {
		    'pv_value': '2',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 2
		    } ]
		}, {
		    'pv_value': '2',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 2
		    } ]
		}, {
		    'pv_value': '2',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 2
		    } ]
		}, {
		    'pv_value': '3',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		}, {
		    'pv_value': '3',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		}, {
		    'pv_value': '3',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		}, {
		    'pv_value': 'flush',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		}, {
		    'pv_value': 'flush',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		}, {
		    'pv_value': 'dropme',
		    'pv_provenance': [ {
		        'pvp_source': 't1', 'pvp_input': 4
		    } ]
		} ]);

		callback();
	});

	t1.write('h');
	t1.write('he');
	t1.write('dropme');
	t1.end('hel');
}

/*
 * Test a pipeline of two instrumented streams.  For each input ("two_hello",
 * "two_worlds"), the first stream emits three outputs with the corresponding
 * lengths ("9" and "10").  Each of these is fed into the second string, which
 * emit three instances of *those* strings' lengths for each one ("1" for both).
 * There will be three instances of "flush" from the first string, each
 * translating to three "5"s from the second, plus 3 "flush" strings from the
 * second string.
 *
 * Besides the streams working correctly, these should all have the right
 * provenance information.
 */
var testPipelineResults = [ {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 1 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 1 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 1 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 2 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 2 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 2 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 3 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 3 } ]
}, {
    'pv_value': '1',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 1 },
		       { 'pvp_source': 't2', 'pvp_input': 3 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 4 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 4 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 4 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 5 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 5 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 5 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 6 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 6 } ]
}, {
    'pv_value': '2',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 6 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 7 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 7 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 7 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 8 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 8 } ]
}, {
    'pv_value': '5',
    'pv_provenance': [ { 'pvp_source': 't1', 'pvp_input': 3 },
		       { 'pvp_source': 't2', 'pvp_input': 8 } ]
}, {
    'pv_value': 'flush',
    'pv_provenance': [ { 'pvp_source': 't2', 'pvp_input': 9 } ]
}, {
    'pv_value': 'flush',
    'pv_provenance': [ { 'pvp_source': 't2', 'pvp_input': 9 } ]
}, {
    'pv_value': 'dropme',
    'pv_provenance': [ { 'pvp_source': 't2', 'pvp_input': 9 } ]
} ];

function testPipeline(_, callback)
{
	var results, t1, t2;

	console.log('test: instrumented two-stream pipeline');
	count = 0;
	results = [];

	t1 = new TestTransform();
	mod_vstream.instrumentObject(t1, { 'name': 't1' });
	mod_vstream.instrumentStream(t1);
	mod_vstream.instrumentTransform(t1);

	t2 = new TestTransform();
	mod_vstream.instrumentObject(t2, { 'name': 't2' });
	mod_vstream.instrumentStream(t2);
	mod_vstream.instrumentTransform(t2);
	t2.vs_marshalmode = 'marshal';

	t2.on('data', function (chunk) { results.push(chunk); });
	t2.on('end', function () {
		t1.vsWalk(
		    function (s) { return (s.vsDumpDebug(process.stdout)); });
		mod_assert.deepEqual(results, testPipelineResults);
		callback();
	});

	t1.on('drop', function (ctx, reason, err) {
		console.log('drop: %s (message: "%s"; source: %s)', reason,
		    err.message, ctx.label());
	});

	t2.on('drop', function (ctx, reason, err) {
		console.log('drop: %s (message: "%s"; source: %s)', reason,
		    err.message, ctx.label());
	});

	t1.pipe(t2);
	t2.vsHead().vsWalk(
	    function (s) { return (s.vsDumpDebug(process.stdout)); });
	t1.write('two_hello');
	t2.vsHead().vsWalk(
	    function (s) { return (s.vsDumpDebug(process.stdout)); });
	t1.write('dropme');
	t1.end('two_worlds');
	t2.vsHead().vsWalk(
	    function (s) { return (s.vsDumpDebug(process.stdout)); });
}

/*
 * Test a pipeline of two instrumented streams where the tail of the pipeline
 * unmarshals the results (e.g., for piping to a non-instrumented pipeline).
 * This looks much like the previous one, but the results are the bare values.
 */
function testPipelineUnmarshaled(_, callback)
{
	var results, t1, t2;

	console.log('test: instrumented two-stream pipeline, umarshaled');
	count = 0;
	results = [];

	t1 = new TestTransform();
	mod_vstream.instrumentObject(t1, { 'name': 't1' });
	mod_vstream.instrumentTransform(t1);

	t2 = new TestTransform();
	mod_vstream.instrumentObject(t2, { 'name': 't2' });
	mod_vstream.instrumentTransform(t2);

	t2.on('data', function (chunk) { results.push(chunk); });
	t2.on('end', function () {
		mod_assert.deepEqual(results, testPipelineResults.map(
		    function (p) { return (p.pv_value); }));
		done = true;
		callback();
	});

	t1.pipe(t2);
	t1.write('two_hello');
	t1.end('two_worlds');
}

mod_vasync.pipeline({
    'funcs': [ testSimple, testPipeline, testPipelineUnmarshaled ]
}, function (err) {
	if (!err && !done)
		err = new Error('premature exit');

	if (err) {
		console.log('TEST FAILED');
		throw (err);
	}

	console.log('TEST PASSED');
});
