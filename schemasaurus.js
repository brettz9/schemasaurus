(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.schemasaurus = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

var CurrentObject = require('./int/context');
var Context = CurrentObject;
var Generator = require('./int/gen');
var Shared = require('./int/shared');
var SchemaPartProcessor = require('./int/processor');
var CodeComposer = require('./int/code');

function defaultLoader() {
    throw new Error("Remote refs are not supported for now :(");
}

function detilde(s) {
    return s.replace(/~0/g, "~").replace(/~1/g, "/");   //do not know how to parse it other way
}

function resolveRef(loader, schemaNode, ref) {
    var remLoc = decodeURI(ref).split("#"), rem = remLoc[0], loc = remLoc[1].split("/").map(detilde), st = schemaNode, i;
    if (rem !== '') {
        st = loader(rem);
    }
    for (i = 0; i < loc.length; i = i + 1) {
        if (loc[i] === '') {
            //noinspection JSLint
            continue;
        }
        st = st[loc[i]];
        if (st === undefined) {
            throw new Error("Cannot find ref '" + ref + "' in schema");
        }
    }
    return st;
}

function prettifyCode(codeLines) {
    var offset = "", step = "  ", line, idx, openBrace, closeBrace;
    for (idx = 0; idx < codeLines.length; idx = idx + 1) {
        line = codeLines[idx].trim();
        openBrace = line.indexOf("{") !== -1;
        closeBrace = line.indexOf("}") !== -1;
        if (closeBrace && !openBrace) {
            offset = offset.substring(0, offset.length - step.length);
        }
        line = offset + line;
        if (openBrace && !closeBrace) {
            offset = offset + step;
        }
        codeLines[idx] = line;
    }
    return codeLines;
}

var attrRe = /(\[(\^?\w+)(=\w+)?\])/g;
var modRe = /:([\-\w]+)$/;

function parseValue(valAsStr) {
    if (valAsStr === null) {
        return null;
    }
    var val = parseFloat(valAsStr);
    if (!isNaN(val)) {
        return val;
    }
    if (valAsStr === "true") {
        return true;
    }
    if (valAsStr === "false") {
        return false;
    }
    return valAsStr;
}

function convertMatcher(expr) {
    if (expr.indexOf(":") !== -1 || expr.indexOf("[") !== -1) {
        var ma = modRe.exec(expr), props = [], attr, not, i, match;
        if (ma) {
            attr = ma[1];
        }
        ma = attrRe.exec(expr);
        while (ma) {
            not = ma[2][0] === '^';
            props.push({
                name: not ? ma[2].substring(1) : ma[2],
                not: not,
                value: ma[3] ? parseValue(ma[3].substring(1)) : undefined
            });
            ma = attrRe.exec(expr);
        }
        return function (schema, att, cb) {
            var sv, found = true;
            if (att !== attr) {
                return false;
            }
            for (i = 0; i < props.length; i = i + 1) {
                sv = schema[props[i].name];
                if (props[i].not) {
                    match = (sv === undefined || (sv !== props[i].value && props[i].value !== undefined));
                } else {
                    match = (sv !== undefined && (sv === props[i].value || props[i].value === undefined));
                }
                if (!match) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return cb(expr);
            }
        };
    }
}

function toFactory(Ctor) {
    if (Object.keys(Ctor.prototype).length !== 0) {
        return function () { return new Ctor(); };
    }
    return Ctor;
}

function SchemaPart(schema, varName, next) {
    this.schema = schema;
    this.varName = varName;
    this.next = next;
}


function Compiler(userSchema, selectorCtor, options, path) {
    if (!selectorCtor || typeof selectorCtor !== 'function') {
        throw new Error("selectorCtor shall be a function");
    }
    this.schemaRoot = userSchema;
    this.selectorCtor = toFactory(selectorCtor);
    this.options = options || {};
    this.options.ignoreAdditionalItems = this.options.ignoreAdditionalItems === undefined ? false : this.options.ignoreAdditionalItems;
    this.ctx = new Context(path);
    this.codeComposer = new CodeComposer();
    this.shared = new Shared();
    this.gen = new Generator("var");
    this.processor = new SchemaPartProcessor(this.gen, this.codeComposer, this.options);

    this.selector = this.selectorCtor();
    this.prepareMatchers();
    this.prepareContext();

}




Compiler.prototype = {
    code: function () {
        this.codeComposer.code.apply(this.codeComposer, arguments);
    },

    subCompile: function (s, path) {
        return new Compiler(s, this.selectorCtor, this.options, path).compile();
    },

    prepareContext: function () {
        this.ctx.compile = function (subschema, newFnName) {
            var ins;
            if (Array.isArray(subschema)) {
                this.ctx[newFnName] = subschema.map(function (s) {
                    return this.subCompile(s);
                }.bind(this));
            } else {
                this.ctx[newFnName] = this.subCompile(subschema, this.ctx.path.slice());
            }
            ins = this.shared.inner(this.ctx[newFnName]);
            this.code("ctx.%% = %%", newFnName, ins);
        }.bind(this);
    },

    prepareMatchers: function () {
        var m, ma;
        this.matchers = [];
        //noinspection JSLint
        for (m in this.selector) {
            //noinspection JSUnfilteredForInLoop
            ma = convertMatcher(m);
            if (ma) {
                this.matchers.push(ma);
            }
        }
    },

    callback: function (schemaPart, attr) {
        var i, self = this, clabel = this.gen.next(), matched = false;
        this.code("%%: {", clabel);

        function onMatch(name) {
            matched = true;
            self.addFn(name, schemaPart, clabel);
        }
        for (i = 0; i < this.matchers.length; i++) {
            this.matchers[i](schemaPart.schema, attr, onMatch);
        }
        if (!matched) {
            this.codeComposer.pop();
        } else {
            this.code("}");
        }
    },

    addFn: function (name, schemaPart, stopLabel) {
        var fn = this.selector[name];
        this.code("//call %%", name);
        if (fn.prepare) {
            this.addFn2(fn.prepare(schemaPart.schema, this.ctx), schemaPart, null, stopLabel);
        } else if (fn.length === 1 || fn.length === 2) {
            this.addFn2(fn.call(this.selector, schemaPart.schema, this.ctx), schemaPart, null, stopLabel);
        } else {
            this.addFn2(fn, schemaPart, name, stopLabel);
        }
    },

    addFn2: function (fn, schemaPart, directCallName, stopLabel) {
        if (fn === undefined || fn === null) {
            return;
        }
        if (typeof fn.inline === 'function' && this.options.noinline) {
            this.code("this['%%'].inline.call(this, %%, ctx)", directCallName, schemaPart.varName);
        } else if (fn.inline) {
            this.codeComposer.inline(fn.inline, schemaPart.varName, stopLabel);
            return; //to skip checking stop
        } else if (directCallName) {
            this.code("this['%%'](%%, %%, ctx)", directCallName, this.shared.schema(schemaPart.schema), schemaPart.varName);
        } else {
            this.code("%%.call(this, %%, %%, ctx)", this.shared.inner(fn), this.shared.schema(schemaPart.schema), schemaPart.varName);
        }
        this.code("if (ctx.isStopped()) break %%", stopLabel);
    },

    step: function (schema, varName, opts) {
        if (schema.$$visited) {
            //TODO: this is solution only for root recursion - to pass official suite :)
            this.code("if (%% !== undefined) self(%%,ctx.path);", varName, varName);
            return;
        }
        Object.defineProperty(schema, "$$visited", {value: true, enumerable: false, configurable: true});
        if (schema.$ref) {
            return this.step(resolveRef(this.options.loader || defaultLoader, this.schemaRoot, schema.$ref), varName, opts);
        }
        this.stepProcess(new SchemaPart(schema, varName, function (cldSchema, cldVarName, sProp, prop, attr) {
            this.ctx.push(sProp, schema, cldSchema);
            this.code("ctx.push(%%, %%, %%)", prop || JSON.stringify(sProp), varName, cldVarName);
            this.step(cldSchema, cldVarName, {attr: attr});
            this.ctx.pop();
            this.code("ctx.pop()");
        }.bind(this)), opts);
        delete schema.$$visited;

    },

    stepProcess: function (schemaPart, opts) {
        var callback = this.callback.bind(this, schemaPart);

        this.processAggregate(schemaPart.schema);

        if (opts && opts.attr) {
            callback(opts.attr);
        }
        callback("start");
        callback();

        this.processor.execute(schemaPart);

        callback("end");
        if (opts && opts.attr) {
            callback(opts.attr + "-end");
        }
    },

    processAggregate: function (schema) {
        ["oneOf", "anyOf", "allOf", "not"].forEach(function (inner) {
            if (schema[inner]) {
                this.ctx.compile(schema[inner], inner);
            }
        }.bind(this));
    },

    addEnd: function () {
        var end = this.selector.end;
        if (end) {
            if (end.inline && !this.options.noinline) {
                this.codeComposer.inline(end.inline, "val", null, true);
            } else {
                this.codeComposer.code("return this.%%", end.inline ? "end.inline.call(this)" : "end()");
            }
        }
    },

    compile: function () {
        var fnbody, fnout;
        this.step(this.schemaRoot, "val");
        this.addEnd();
        fnbody = prettifyCode(this.codeComposer.codeLines).map(function (line) {
            return "{};".indexOf(line[line.length - 1]) === -1 ? line + ";" : line;
        }).join("\n");
        fnbody = ['var GraphemeBreaker;' + "(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require==\"function\"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error(\"Cannot find module '\"+o+\"'\");throw f.code=\"MODULE_NOT_FOUND\",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require==\"function\"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){\n/*!\n * The buffer module from node.js, for the browser.\n *\n * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>\n * @license  MIT\n */\n\nvar base64 = require('base64-js')\nvar ieee754 = require('ieee754')\nvar isArray = require('is-array')\n\nexports.Buffer = Buffer\nexports.SlowBuffer = SlowBuffer\nexports.INSPECT_MAX_BYTES = 50\nBuffer.poolSize = 8192 // not used by this implementation\n\nvar kMaxLength = 0x3fffffff\nvar rootParent = {}\n\n/**\n * If `Buffer.TYPED_ARRAY_SUPPORT`:\n *   === true    Use Uint8Array implementation (fastest)\n *   === false   Use Object implementation (most compatible, even IE6)\n *\n * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,\n * Opera 11.6+, iOS 4.2+.\n *\n * Note:\n *\n * - Implementation must support adding new properties to `Uint8Array` instances.\n *   Firefox 4-29 lacked support, fixed in Firefox 30+.\n *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.\n *\n *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.\n *\n *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of\n *    incorrect length in some situations.\n *\n * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will\n * get the Object implementation, which is slower but will work correctly.\n */\nBuffer.TYPED_ARRAY_SUPPORT = (function () {\n  try {\n    var buf = new ArrayBuffer(0)\n    var arr = new Uint8Array(buf)\n    arr.foo = function () { return 42 }\n    return arr.foo() === 42 && // typed array instances can be augmented\n        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`\n        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`\n  } catch (e) {\n    return false\n  }\n})()\n\n/**\n * Class: Buffer\n * =============\n *\n * The Buffer constructor returns instances of `Uint8Array` that are augmented\n * with function properties for all the node `Buffer` API functions. We use\n * `Uint8Array` so that square bracket notation works as expected -- it returns\n * a single octet.\n *\n * By augmenting the instances, we can avoid modifying the `Uint8Array`\n * prototype.\n */\nfunction Buffer (arg) {\n  if (!(this instanceof Buffer)) {\n    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.\n    if (arguments.length > 1) return new Buffer(arg, arguments[1])\n    return new Buffer(arg)\n  }\n\n  this.length = 0\n  this.parent = undefined\n\n  // Common case.\n  if (typeof arg === 'number') {\n    return fromNumber(this, arg)\n  }\n\n  // Slightly less common case.\n  if (typeof arg === 'string') {\n    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')\n  }\n\n  // Unusual.\n  return fromObject(this, arg)\n}\n\nfunction fromNumber (that, length) {\n  that = allocate(that, length < 0 ? 0 : checked(length) | 0)\n  if (!Buffer.TYPED_ARRAY_SUPPORT) {\n    for (var i = 0; i < length; i++) {\n      that[i] = 0\n    }\n  }\n  return that\n}\n\nfunction fromString (that, string, encoding) {\n  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'\n\n  // Assumption: byteLength() return value is always < kMaxLength.\n  var length = byteLength(string, encoding) | 0\n  that = allocate(that, length)\n\n  that.write(string, encoding)\n  return that\n}\n\nfunction fromObject (that, object) {\n  if (Buffer.isBuffer(object)) return fromBuffer(that, object)\n\n  if (isArray(object)) return fromArray(that, object)\n\n  if (object == null) {\n    throw new TypeError('must start with number, buffer, array or string')\n  }\n\n  if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {\n    return fromTypedArray(that, object)\n  }\n\n  if (object.length) return fromArrayLike(that, object)\n\n  return fromJsonObject(that, object)\n}\n\nfunction fromBuffer (that, buffer) {\n  var length = checked(buffer.length) | 0\n  that = allocate(that, length)\n  buffer.copy(that, 0, 0, length)\n  return that\n}\n\nfunction fromArray (that, array) {\n  var length = checked(array.length) | 0\n  that = allocate(that, length)\n  for (var i = 0; i < length; i += 1) {\n    that[i] = array[i] & 255\n  }\n  return that\n}\n\n// Duplicate of fromArray() to keep fromArray() monomorphic.\nfunction fromTypedArray (that, array) {\n  var length = checked(array.length) | 0\n  that = allocate(that, length)\n  // Truncating the elements is probably not what people expect from typed\n  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior\n  // of the old Buffer constructor.\n  for (var i = 0; i < length; i += 1) {\n    that[i] = array[i] & 255\n  }\n  return that\n}\n\nfunction fromArrayLike (that, array) {\n  var length = checked(array.length) | 0\n  that = allocate(that, length)\n  for (var i = 0; i < length; i += 1) {\n    that[i] = array[i] & 255\n  }\n  return that\n}\n\n// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.\n// Returns a zero-length buffer for inputs that don't conform to the spec.\nfunction fromJsonObject (that, object) {\n  var array\n  var length = 0\n\n  if (object.type === 'Buffer' && isArray(object.data)) {\n    array = object.data\n    length = checked(array.length) | 0\n  }\n  that = allocate(that, length)\n\n  for (var i = 0; i < length; i += 1) {\n    that[i] = array[i] & 255\n  }\n  return that\n}\n\nfunction allocate (that, length) {\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    // Return an augmented `Uint8Array` instance, for best performance\n    that = Buffer._augment(new Uint8Array(length))\n  } else {\n    // Fallback: Return an object instance of the Buffer class\n    that.length = length\n    that._isBuffer = true\n  }\n\n  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1\n  if (fromPool) that.parent = rootParent\n\n  return that\n}\n\nfunction checked (length) {\n  // Note: cannot use `length < kMaxLength` here because that fails when\n  // length is NaN (which is otherwise coerced to zero.)\n  if (length >= kMaxLength) {\n    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +\n                         'size: 0x' + kMaxLength.toString(16) + ' bytes')\n  }\n  return length | 0\n}\n\nfunction SlowBuffer (subject, encoding) {\n  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)\n\n  var buf = new Buffer(subject, encoding)\n  delete buf.parent\n  return buf\n}\n\nBuffer.isBuffer = function isBuffer (b) {\n  return !!(b != null && b._isBuffer)\n}\n\nBuffer.compare = function compare (a, b) {\n  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {\n    throw new TypeError('Arguments must be Buffers')\n  }\n\n  if (a === b) return 0\n\n  var x = a.length\n  var y = b.length\n\n  var i = 0\n  var len = Math.min(x, y)\n  while (i < len) {\n    if (a[i] !== b[i]) break\n\n    ++i\n  }\n\n  if (i !== len) {\n    x = a[i]\n    y = b[i]\n  }\n\n  if (x < y) return -1\n  if (y < x) return 1\n  return 0\n}\n\nBuffer.isEncoding = function isEncoding (encoding) {\n  switch (String(encoding).toLowerCase()) {\n    case 'hex':\n    case 'utf8':\n    case 'utf-8':\n    case 'ascii':\n    case 'binary':\n    case 'base64':\n    case 'raw':\n    case 'ucs2':\n    case 'ucs-2':\n    case 'utf16le':\n    case 'utf-16le':\n      return true\n    default:\n      return false\n  }\n}\n\nBuffer.concat = function concat (list, length) {\n  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')\n\n  if (list.length === 0) {\n    return new Buffer(0)\n  } else if (list.length === 1) {\n    return list[0]\n  }\n\n  var i\n  if (length === undefined) {\n    length = 0\n    for (i = 0; i < list.length; i++) {\n      length += list[i].length\n    }\n  }\n\n  var buf = new Buffer(length)\n  var pos = 0\n  for (i = 0; i < list.length; i++) {\n    var item = list[i]\n    item.copy(buf, pos)\n    pos += item.length\n  }\n  return buf\n}\n\nfunction byteLength (string, encoding) {\n  if (typeof string !== 'string') string = String(string)\n\n  if (string.length === 0) return 0\n\n  switch (encoding || 'utf8') {\n    case 'ascii':\n    case 'binary':\n    case 'raw':\n      return string.length\n    case 'ucs2':\n    case 'ucs-2':\n    case 'utf16le':\n    case 'utf-16le':\n      return string.length * 2\n    case 'hex':\n      return string.length >>> 1\n    case 'utf8':\n    case 'utf-8':\n      return utf8ToBytes(string).length\n    case 'base64':\n      return base64ToBytes(string).length\n    default:\n      return string.length\n  }\n}\nBuffer.byteLength = byteLength\n\n// pre-set for values that may exist in the future\nBuffer.prototype.length = undefined\nBuffer.prototype.parent = undefined\n\n// toString(encoding, start=0, end=buffer.length)\nBuffer.prototype.toString = function toString (encoding, start, end) {\n  var loweredCase = false\n\n  start = start | 0\n  end = end === undefined || end === Infinity ? this.length : end | 0\n\n  if (!encoding) encoding = 'utf8'\n  if (start < 0) start = 0\n  if (end > this.length) end = this.length\n  if (end <= start) return ''\n\n  while (true) {\n    switch (encoding) {\n      case 'hex':\n        return hexSlice(this, start, end)\n\n      case 'utf8':\n      case 'utf-8':\n        return utf8Slice(this, start, end)\n\n      case 'ascii':\n        return asciiSlice(this, start, end)\n\n      case 'binary':\n        return binarySlice(this, start, end)\n\n      case 'base64':\n        return base64Slice(this, start, end)\n\n      case 'ucs2':\n      case 'ucs-2':\n      case 'utf16le':\n      case 'utf-16le':\n        return utf16leSlice(this, start, end)\n\n      default:\n        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)\n        encoding = (encoding + '').toLowerCase()\n        loweredCase = true\n    }\n  }\n}\n\nBuffer.prototype.equals = function equals (b) {\n  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')\n  if (this === b) return true\n  return Buffer.compare(this, b) === 0\n}\n\nBuffer.prototype.inspect = function inspect () {\n  var str = ''\n  var max = exports.INSPECT_MAX_BYTES\n  if (this.length > 0) {\n    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')\n    if (this.length > max) str += ' ... '\n  }\n  return '<Buffer ' + str + '>'\n}\n\nBuffer.prototype.compare = function compare (b) {\n  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')\n  if (this === b) return 0\n  return Buffer.compare(this, b)\n}\n\nBuffer.prototype.indexOf = function indexOf (val, byteOffset) {\n  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff\n  else if (byteOffset < -0x80000000) byteOffset = -0x80000000\n  byteOffset >>= 0\n\n  if (this.length === 0) return -1\n  if (byteOffset >= this.length) return -1\n\n  // Negative offsets start from the end of the buffer\n  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)\n\n  if (typeof val === 'string') {\n    if (val.length === 0) return -1 // special case: looking for empty string always fails\n    return String.prototype.indexOf.call(this, val, byteOffset)\n  }\n  if (Buffer.isBuffer(val)) {\n    return arrayIndexOf(this, val, byteOffset)\n  }\n  if (typeof val === 'number') {\n    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {\n      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)\n    }\n    return arrayIndexOf(this, [ val ], byteOffset)\n  }\n\n  function arrayIndexOf (arr, val, byteOffset) {\n    var foundIndex = -1\n    for (var i = 0; byteOffset + i < arr.length; i++) {\n      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {\n        if (foundIndex === -1) foundIndex = i\n        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex\n      } else {\n        foundIndex = -1\n      }\n    }\n    return -1\n  }\n\n  throw new TypeError('val must be string, number or Buffer')\n}\n\n// `get` will be removed in Node 0.13+\nBuffer.prototype.get = function get (offset) {\n  console.log('.get() is deprecated. Access using array indexes instead.')\n  return this.readUInt8(offset)\n}\n\n// `set` will be removed in Node 0.13+\nBuffer.prototype.set = function set (v, offset) {\n  console.log('.set() is deprecated. Access using array indexes instead.')\n  return this.writeUInt8(v, offset)\n}\n\nfunction hexWrite (buf, string, offset, length) {\n  offset = Number(offset) || 0\n  var remaining = buf.length - offset\n  if (!length) {\n    length = remaining\n  } else {\n    length = Number(length)\n    if (length > remaining) {\n      length = remaining\n    }\n  }\n\n  // must be an even number of digits\n  var strLen = string.length\n  if (strLen % 2 !== 0) throw new Error('Invalid hex string')\n\n  if (length > strLen / 2) {\n    length = strLen / 2\n  }\n  for (var i = 0; i < length; i++) {\n    var parsed = parseInt(string.substr(i * 2, 2), 16)\n    if (isNaN(parsed)) throw new Error('Invalid hex string')\n    buf[offset + i] = parsed\n  }\n  return i\n}\n\nfunction utf8Write (buf, string, offset, length) {\n  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)\n}\n\nfunction asciiWrite (buf, string, offset, length) {\n  return blitBuffer(asciiToBytes(string), buf, offset, length)\n}\n\nfunction binaryWrite (buf, string, offset, length) {\n  return asciiWrite(buf, string, offset, length)\n}\n\nfunction base64Write (buf, string, offset, length) {\n  return blitBuffer(base64ToBytes(string), buf, offset, length)\n}\n\nfunction ucs2Write (buf, string, offset, length) {\n  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)\n}\n\nBuffer.prototype.write = function write (string, offset, length, encoding) {\n  // Buffer#write(string)\n  if (offset === undefined) {\n    encoding = 'utf8'\n    length = this.length\n    offset = 0\n  // Buffer#write(string, encoding)\n  } else if (length === undefined && typeof offset === 'string') {\n    encoding = offset\n    length = this.length\n    offset = 0\n  // Buffer#write(string, offset[, length][, encoding])\n  } else if (isFinite(offset)) {\n    offset = offset | 0\n    if (isFinite(length)) {\n      length = length | 0\n      if (encoding === undefined) encoding = 'utf8'\n    } else {\n      encoding = length\n      length = undefined\n    }\n  // legacy write(string, encoding, offset, length) - remove in v0.13\n  } else {\n    var swap = encoding\n    encoding = offset\n    offset = length | 0\n    length = swap\n  }\n\n  var remaining = this.length - offset\n  if (length === undefined || length > remaining) length = remaining\n\n  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {\n    throw new RangeError('attempt to write outside buffer bounds')\n  }\n\n  if (!encoding) encoding = 'utf8'\n\n  var loweredCase = false\n  for (;;) {\n    switch (encoding) {\n      case 'hex':\n        return hexWrite(this, string, offset, length)\n\n      case 'utf8':\n      case 'utf-8':\n        return utf8Write(this, string, offset, length)\n\n      case 'ascii':\n        return asciiWrite(this, string, offset, length)\n\n      case 'binary':\n        return binaryWrite(this, string, offset, length)\n\n      case 'base64':\n        // Warning: maxLength not taken into account in base64Write\n        return base64Write(this, string, offset, length)\n\n      case 'ucs2':\n      case 'ucs-2':\n      case 'utf16le':\n      case 'utf-16le':\n        return ucs2Write(this, string, offset, length)\n\n      default:\n        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)\n        encoding = ('' + encoding).toLowerCase()\n        loweredCase = true\n    }\n  }\n}\n\nBuffer.prototype.toJSON = function toJSON () {\n  return {\n    type: 'Buffer',\n    data: Array.prototype.slice.call(this._arr || this, 0)\n  }\n}\n\nfunction base64Slice (buf, start, end) {\n  if (start === 0 && end === buf.length) {\n    return base64.fromByteArray(buf)\n  } else {\n    return base64.fromByteArray(buf.slice(start, end))\n  }\n}\n\nfunction utf8Slice (buf, start, end) {\n  var res = ''\n  var tmp = ''\n  end = Math.min(buf.length, end)\n\n  for (var i = start; i < end; i++) {\n    if (buf[i] <= 0x7F) {\n      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])\n      tmp = ''\n    } else {\n      tmp += '%' + buf[i].toString(16)\n    }\n  }\n\n  return res + decodeUtf8Char(tmp)\n}\n\nfunction asciiSlice (buf, start, end) {\n  var ret = ''\n  end = Math.min(buf.length, end)\n\n  for (var i = start; i < end; i++) {\n    ret += String.fromCharCode(buf[i] & 0x7F)\n  }\n  return ret\n}\n\nfunction binarySlice (buf, start, end) {\n  var ret = ''\n  end = Math.min(buf.length, end)\n\n  for (var i = start; i < end; i++) {\n    ret += String.fromCharCode(buf[i])\n  }\n  return ret\n}\n\nfunction hexSlice (buf, start, end) {\n  var len = buf.length\n\n  if (!start || start < 0) start = 0\n  if (!end || end < 0 || end > len) end = len\n\n  var out = ''\n  for (var i = start; i < end; i++) {\n    out += toHex(buf[i])\n  }\n  return out\n}\n\nfunction utf16leSlice (buf, start, end) {\n  var bytes = buf.slice(start, end)\n  var res = ''\n  for (var i = 0; i < bytes.length; i += 2) {\n    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)\n  }\n  return res\n}\n\nBuffer.prototype.slice = function slice (start, end) {\n  var len = this.length\n  start = ~~start\n  end = end === undefined ? len : ~~end\n\n  if (start < 0) {\n    start += len\n    if (start < 0) start = 0\n  } else if (start > len) {\n    start = len\n  }\n\n  if (end < 0) {\n    end += len\n    if (end < 0) end = 0\n  } else if (end > len) {\n    end = len\n  }\n\n  if (end < start) end = start\n\n  var newBuf\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    newBuf = Buffer._augment(this.subarray(start, end))\n  } else {\n    var sliceLen = end - start\n    newBuf = new Buffer(sliceLen, undefined)\n    for (var i = 0; i < sliceLen; i++) {\n      newBuf[i] = this[i + start]\n    }\n  }\n\n  if (newBuf.length) newBuf.parent = this.parent || this\n\n  return newBuf\n}\n\n/*\n * Need to make sure that buffer isn't trying to write out of bounds.\n */\nfunction checkOffset (offset, ext, length) {\n  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')\n  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')\n}\n\nBuffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) checkOffset(offset, byteLength, this.length)\n\n  var val = this[offset]\n  var mul = 1\n  var i = 0\n  while (++i < byteLength && (mul *= 0x100)) {\n    val += this[offset + i] * mul\n  }\n\n  return val\n}\n\nBuffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) {\n    checkOffset(offset, byteLength, this.length)\n  }\n\n  var val = this[offset + --byteLength]\n  var mul = 1\n  while (byteLength > 0 && (mul *= 0x100)) {\n    val += this[offset + --byteLength] * mul\n  }\n\n  return val\n}\n\nBuffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 1, this.length)\n  return this[offset]\n}\n\nBuffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 2, this.length)\n  return this[offset] | (this[offset + 1] << 8)\n}\n\nBuffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 2, this.length)\n  return (this[offset] << 8) | this[offset + 1]\n}\n\nBuffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n\n  return ((this[offset]) |\n      (this[offset + 1] << 8) |\n      (this[offset + 2] << 16)) +\n      (this[offset + 3] * 0x1000000)\n}\n\nBuffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n\n  return (this[offset] * 0x1000000) +\n    ((this[offset + 1] << 16) |\n    (this[offset + 2] << 8) |\n    this[offset + 3])\n}\n\nBuffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) checkOffset(offset, byteLength, this.length)\n\n  var val = this[offset]\n  var mul = 1\n  var i = 0\n  while (++i < byteLength && (mul *= 0x100)) {\n    val += this[offset + i] * mul\n  }\n  mul *= 0x80\n\n  if (val >= mul) val -= Math.pow(2, 8 * byteLength)\n\n  return val\n}\n\nBuffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) checkOffset(offset, byteLength, this.length)\n\n  var i = byteLength\n  var mul = 1\n  var val = this[offset + --i]\n  while (i > 0 && (mul *= 0x100)) {\n    val += this[offset + --i] * mul\n  }\n  mul *= 0x80\n\n  if (val >= mul) val -= Math.pow(2, 8 * byteLength)\n\n  return val\n}\n\nBuffer.prototype.readInt8 = function readInt8 (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 1, this.length)\n  if (!(this[offset] & 0x80)) return (this[offset])\n  return ((0xff - this[offset] + 1) * -1)\n}\n\nBuffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 2, this.length)\n  var val = this[offset] | (this[offset + 1] << 8)\n  return (val & 0x8000) ? val | 0xFFFF0000 : val\n}\n\nBuffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 2, this.length)\n  var val = this[offset + 1] | (this[offset] << 8)\n  return (val & 0x8000) ? val | 0xFFFF0000 : val\n}\n\nBuffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n\n  return (this[offset]) |\n    (this[offset + 1] << 8) |\n    (this[offset + 2] << 16) |\n    (this[offset + 3] << 24)\n}\n\nBuffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n\n  return (this[offset] << 24) |\n    (this[offset + 1] << 16) |\n    (this[offset + 2] << 8) |\n    (this[offset + 3])\n}\n\nBuffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n  return ieee754.read(this, offset, true, 23, 4)\n}\n\nBuffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 4, this.length)\n  return ieee754.read(this, offset, false, 23, 4)\n}\n\nBuffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 8, this.length)\n  return ieee754.read(this, offset, true, 52, 8)\n}\n\nBuffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {\n  if (!noAssert) checkOffset(offset, 8, this.length)\n  return ieee754.read(this, offset, false, 52, 8)\n}\n\nfunction checkInt (buf, value, offset, ext, max, min) {\n  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')\n  if (value > max || value < min) throw new RangeError('value is out of bounds')\n  if (offset + ext > buf.length) throw new RangeError('index out of range')\n}\n\nBuffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {\n  value = +value\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)\n\n  var mul = 1\n  var i = 0\n  this[offset] = value & 0xFF\n  while (++i < byteLength && (mul *= 0x100)) {\n    this[offset + i] = (value / mul) & 0xFF\n  }\n\n  return offset + byteLength\n}\n\nBuffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {\n  value = +value\n  offset = offset | 0\n  byteLength = byteLength | 0\n  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)\n\n  var i = byteLength - 1\n  var mul = 1\n  this[offset + i] = value & 0xFF\n  while (--i >= 0 && (mul *= 0x100)) {\n    this[offset + i] = (value / mul) & 0xFF\n  }\n\n  return offset + byteLength\n}\n\nBuffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)\n  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)\n  this[offset] = value\n  return offset + 1\n}\n\nfunction objectWriteUInt16 (buf, value, offset, littleEndian) {\n  if (value < 0) value = 0xffff + value + 1\n  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {\n    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>\n      (littleEndian ? i : 1 - i) * 8\n  }\n}\n\nBuffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = value\n    this[offset + 1] = (value >>> 8)\n  } else {\n    objectWriteUInt16(this, value, offset, true)\n  }\n  return offset + 2\n}\n\nBuffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = (value >>> 8)\n    this[offset + 1] = value\n  } else {\n    objectWriteUInt16(this, value, offset, false)\n  }\n  return offset + 2\n}\n\nfunction objectWriteUInt32 (buf, value, offset, littleEndian) {\n  if (value < 0) value = 0xffffffff + value + 1\n  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {\n    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff\n  }\n}\n\nBuffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset + 3] = (value >>> 24)\n    this[offset + 2] = (value >>> 16)\n    this[offset + 1] = (value >>> 8)\n    this[offset] = value\n  } else {\n    objectWriteUInt32(this, value, offset, true)\n  }\n  return offset + 4\n}\n\nBuffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = (value >>> 24)\n    this[offset + 1] = (value >>> 16)\n    this[offset + 2] = (value >>> 8)\n    this[offset + 3] = value\n  } else {\n    objectWriteUInt32(this, value, offset, false)\n  }\n  return offset + 4\n}\n\nBuffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) {\n    var limit = Math.pow(2, 8 * byteLength - 1)\n\n    checkInt(this, value, offset, byteLength, limit - 1, -limit)\n  }\n\n  var i = 0\n  var mul = 1\n  var sub = value < 0 ? 1 : 0\n  this[offset] = value & 0xFF\n  while (++i < byteLength && (mul *= 0x100)) {\n    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF\n  }\n\n  return offset + byteLength\n}\n\nBuffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) {\n    var limit = Math.pow(2, 8 * byteLength - 1)\n\n    checkInt(this, value, offset, byteLength, limit - 1, -limit)\n  }\n\n  var i = byteLength - 1\n  var mul = 1\n  var sub = value < 0 ? 1 : 0\n  this[offset + i] = value & 0xFF\n  while (--i >= 0 && (mul *= 0x100)) {\n    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF\n  }\n\n  return offset + byteLength\n}\n\nBuffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)\n  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)\n  if (value < 0) value = 0xff + value + 1\n  this[offset] = value\n  return offset + 1\n}\n\nBuffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = value\n    this[offset + 1] = (value >>> 8)\n  } else {\n    objectWriteUInt16(this, value, offset, true)\n  }\n  return offset + 2\n}\n\nBuffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = (value >>> 8)\n    this[offset + 1] = value\n  } else {\n    objectWriteUInt16(this, value, offset, false)\n  }\n  return offset + 2\n}\n\nBuffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = value\n    this[offset + 1] = (value >>> 8)\n    this[offset + 2] = (value >>> 16)\n    this[offset + 3] = (value >>> 24)\n  } else {\n    objectWriteUInt32(this, value, offset, true)\n  }\n  return offset + 4\n}\n\nBuffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {\n  value = +value\n  offset = offset | 0\n  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)\n  if (value < 0) value = 0xffffffff + value + 1\n  if (Buffer.TYPED_ARRAY_SUPPORT) {\n    this[offset] = (value >>> 24)\n    this[offset + 1] = (value >>> 16)\n    this[offset + 2] = (value >>> 8)\n    this[offset + 3] = value\n  } else {\n    objectWriteUInt32(this, value, offset, false)\n  }\n  return offset + 4\n}\n\nfunction checkIEEE754 (buf, value, offset, ext, max, min) {\n  if (value > max || value < min) throw new RangeError('value is out of bounds')\n  if (offset + ext > buf.length) throw new RangeError('index out of range')\n  if (offset < 0) throw new RangeError('index out of range')\n}\n\nfunction writeFloat (buf, value, offset, littleEndian, noAssert) {\n  if (!noAssert) {\n    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)\n  }\n  ieee754.write(buf, value, offset, littleEndian, 23, 4)\n  return offset + 4\n}\n\nBuffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {\n  return writeFloat(this, value, offset, true, noAssert)\n}\n\nBuffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {\n  return writeFloat(this, value, offset, false, noAssert)\n}\n\nfunction writeDouble (buf, value, offset, littleEndian, noAssert) {\n  if (!noAssert) {\n    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)\n  }\n  ieee754.write(buf, value, offset, littleEndian, 52, 8)\n  return offset + 8\n}\n\nBuffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {\n  return writeDouble(this, value, offset, true, noAssert)\n}\n\nBuffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {\n  return writeDouble(this, value, offset, false, noAssert)\n}\n\n// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)\nBuffer.prototype.copy = function copy (target, targetStart, start, end) {\n  if (!start) start = 0\n  if (!end && end !== 0) end = this.length\n  if (targetStart >= target.length) targetStart = target.length\n  if (!targetStart) targetStart = 0\n  if (end > 0 && end < start) end = start\n\n  // Copy 0 bytes; we're done\n  if (end === start) return 0\n  if (target.length === 0 || this.length === 0) return 0\n\n  // Fatal error conditions\n  if (targetStart < 0) {\n    throw new RangeError('targetStart out of bounds')\n  }\n  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')\n  if (end < 0) throw new RangeError('sourceEnd out of bounds')\n\n  // Are we oob?\n  if (end > this.length) end = this.length\n  if (target.length - targetStart < end - start) {\n    end = target.length - targetStart + start\n  }\n\n  var len = end - start\n\n  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {\n    for (var i = 0; i < len; i++) {\n      target[i + targetStart] = this[i + start]\n    }\n  } else {\n    target._set(this.subarray(start, start + len), targetStart)\n  }\n\n  return len\n}\n\n// fill(value, start=0, end=buffer.length)\nBuffer.prototype.fill = function fill (value, start, end) {\n  if (!value) value = 0\n  if (!start) start = 0\n  if (!end) end = this.length\n\n  if (end < start) throw new RangeError('end < start')\n\n  // Fill 0 bytes; we're done\n  if (end === start) return\n  if (this.length === 0) return\n\n  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')\n  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')\n\n  var i\n  if (typeof value === 'number') {\n    for (i = start; i < end; i++) {\n      this[i] = value\n    }\n  } else {\n    var bytes = utf8ToBytes(value.toString())\n    var len = bytes.length\n    for (i = start; i < end; i++) {\n      this[i] = bytes[i % len]\n    }\n  }\n\n  return this\n}\n\n/**\n * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.\n * Added in Node 0.12. Only available in browsers that support ArrayBuffer.\n */\nBuffer.prototype.toArrayBuffer = function toArrayBuffer () {\n  if (typeof Uint8Array !== 'undefined') {\n    if (Buffer.TYPED_ARRAY_SUPPORT) {\n      return (new Buffer(this)).buffer\n    } else {\n      var buf = new Uint8Array(this.length)\n      for (var i = 0, len = buf.length; i < len; i += 1) {\n        buf[i] = this[i]\n      }\n      return buf.buffer\n    }\n  } else {\n    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')\n  }\n}\n\n// HELPER FUNCTIONS\n// ================\n\nvar BP = Buffer.prototype\n\n/**\n * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods\n */\nBuffer._augment = function _augment (arr) {\n  arr.constructor = Buffer\n  arr._isBuffer = true\n\n  // save reference to original Uint8Array set method before overwriting\n  arr._set = arr.set\n\n  // deprecated, will be removed in node 0.13+\n  arr.get = BP.get\n  arr.set = BP.set\n\n  arr.write = BP.write\n  arr.toString = BP.toString\n  arr.toLocaleString = BP.toString\n  arr.toJSON = BP.toJSON\n  arr.equals = BP.equals\n  arr.compare = BP.compare\n  arr.indexOf = BP.indexOf\n  arr.copy = BP.copy\n  arr.slice = BP.slice\n  arr.readUIntLE = BP.readUIntLE\n  arr.readUIntBE = BP.readUIntBE\n  arr.readUInt8 = BP.readUInt8\n  arr.readUInt16LE = BP.readUInt16LE\n  arr.readUInt16BE = BP.readUInt16BE\n  arr.readUInt32LE = BP.readUInt32LE\n  arr.readUInt32BE = BP.readUInt32BE\n  arr.readIntLE = BP.readIntLE\n  arr.readIntBE = BP.readIntBE\n  arr.readInt8 = BP.readInt8\n  arr.readInt16LE = BP.readInt16LE\n  arr.readInt16BE = BP.readInt16BE\n  arr.readInt32LE = BP.readInt32LE\n  arr.readInt32BE = BP.readInt32BE\n  arr.readFloatLE = BP.readFloatLE\n  arr.readFloatBE = BP.readFloatBE\n  arr.readDoubleLE = BP.readDoubleLE\n  arr.readDoubleBE = BP.readDoubleBE\n  arr.writeUInt8 = BP.writeUInt8\n  arr.writeUIntLE = BP.writeUIntLE\n  arr.writeUIntBE = BP.writeUIntBE\n  arr.writeUInt16LE = BP.writeUInt16LE\n  arr.writeUInt16BE = BP.writeUInt16BE\n  arr.writeUInt32LE = BP.writeUInt32LE\n  arr.writeUInt32BE = BP.writeUInt32BE\n  arr.writeIntLE = BP.writeIntLE\n  arr.writeIntBE = BP.writeIntBE\n  arr.writeInt8 = BP.writeInt8\n  arr.writeInt16LE = BP.writeInt16LE\n  arr.writeInt16BE = BP.writeInt16BE\n  arr.writeInt32LE = BP.writeInt32LE\n  arr.writeInt32BE = BP.writeInt32BE\n  arr.writeFloatLE = BP.writeFloatLE\n  arr.writeFloatBE = BP.writeFloatBE\n  arr.writeDoubleLE = BP.writeDoubleLE\n  arr.writeDoubleBE = BP.writeDoubleBE\n  arr.fill = BP.fill\n  arr.inspect = BP.inspect\n  arr.toArrayBuffer = BP.toArrayBuffer\n\n  return arr\n}\n\nvar INVALID_BASE64_RE = /[^+\\/0-9A-z\\-]/g\n\nfunction base64clean (str) {\n  // Node strips out invalid characters like \\n and \\t from the string, base64-js does not\n  str = stringtrim(str).replace(INVALID_BASE64_RE, '')\n  // Node converts strings with length < 2 to ''\n  if (str.length < 2) return ''\n  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not\n  while (str.length % 4 !== 0) {\n    str = str + '='\n  }\n  return str\n}\n\nfunction stringtrim (str) {\n  if (str.trim) return str.trim()\n  return str.replace(/^\\s+|\\s+$/g, '')\n}\n\nfunction toHex (n) {\n  if (n < 16) return '0' + n.toString(16)\n  return n.toString(16)\n}\n\nfunction utf8ToBytes (string, units) {\n  units = units || Infinity\n  var codePoint\n  var length = string.length\n  var leadSurrogate = null\n  var bytes = []\n  var i = 0\n\n  for (; i < length; i++) {\n    codePoint = string.charCodeAt(i)\n\n    // is surrogate component\n    if (codePoint > 0xD7FF && codePoint < 0xE000) {\n      // last char was a lead\n      if (leadSurrogate) {\n        // 2 leads in a row\n        if (codePoint < 0xDC00) {\n          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)\n          leadSurrogate = codePoint\n          continue\n        } else {\n          // valid surrogate pair\n          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000\n          leadSurrogate = null\n        }\n      } else {\n        // no lead yet\n\n        if (codePoint > 0xDBFF) {\n          // unexpected trail\n          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)\n          continue\n        } else if (i + 1 === length) {\n          // unpaired lead\n          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)\n          continue\n        } else {\n          // valid lead\n          leadSurrogate = codePoint\n          continue\n        }\n      }\n    } else if (leadSurrogate) {\n      // valid bmp char, but last char was a lead\n      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)\n      leadSurrogate = null\n    }\n\n    // encode utf8\n    if (codePoint < 0x80) {\n      if ((units -= 1) < 0) break\n      bytes.push(codePoint)\n    } else if (codePoint < 0x800) {\n      if ((units -= 2) < 0) break\n      bytes.push(\n        codePoint >> 0x6 | 0xC0,\n        codePoint & 0x3F | 0x80\n      )\n    } else if (codePoint < 0x10000) {\n      if ((units -= 3) < 0) break\n      bytes.push(\n        codePoint >> 0xC | 0xE0,\n        codePoint >> 0x6 & 0x3F | 0x80,\n        codePoint & 0x3F | 0x80\n      )\n    } else if (codePoint < 0x200000) {\n      if ((units -= 4) < 0) break\n      bytes.push(\n        codePoint >> 0x12 | 0xF0,\n        codePoint >> 0xC & 0x3F | 0x80,\n        codePoint >> 0x6 & 0x3F | 0x80,\n        codePoint & 0x3F | 0x80\n      )\n    } else {\n      throw new Error('Invalid code point')\n    }\n  }\n\n  return bytes\n}\n\nfunction asciiToBytes (str) {\n  var byteArray = []\n  for (var i = 0; i < str.length; i++) {\n    // Node's code seems to be doing this and not & 0x7F..\n    byteArray.push(str.charCodeAt(i) & 0xFF)\n  }\n  return byteArray\n}\n\nfunction utf16leToBytes (str, units) {\n  var c, hi, lo\n  var byteArray = []\n  for (var i = 0; i < str.length; i++) {\n    if ((units -= 2) < 0) break\n\n    c = str.charCodeAt(i)\n    hi = c >> 8\n    lo = c % 256\n    byteArray.push(lo)\n    byteArray.push(hi)\n  }\n\n  return byteArray\n}\n\nfunction base64ToBytes (str) {\n  return base64.toByteArray(base64clean(str))\n}\n\nfunction blitBuffer (src, dst, offset, length) {\n  for (var i = 0; i < length; i++) {\n    if ((i + offset >= dst.length) || (i >= src.length)) break\n    dst[i + offset] = src[i]\n  }\n  return i\n}\n\nfunction decodeUtf8Char (str) {\n  try {\n    return decodeURIComponent(str)\n  } catch (err) {\n    return String.fromCharCode(0xFFFD) // UTF 8 invalid char\n  }\n}\n\n},{\"base64-js\":2,\"ieee754\":3,\"is-array\":4}],2:[function(require,module,exports){\nvar lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';\n\n;(function (exports) {\n\t'use strict';\n\n  var Arr = (typeof Uint8Array !== 'undefined')\n    ? Uint8Array\n    : Array\n\n\tvar PLUS   = '+'.charCodeAt(0)\n\tvar SLASH  = '/'.charCodeAt(0)\n\tvar NUMBER = '0'.charCodeAt(0)\n\tvar LOWER  = 'a'.charCodeAt(0)\n\tvar UPPER  = 'A'.charCodeAt(0)\n\tvar PLUS_URL_SAFE = '-'.charCodeAt(0)\n\tvar SLASH_URL_SAFE = '_'.charCodeAt(0)\n\n\tfunction decode (elt) {\n\t\tvar code = elt.charCodeAt(0)\n\t\tif (code === PLUS ||\n\t\t    code === PLUS_URL_SAFE)\n\t\t\treturn 62 // '+'\n\t\tif (code === SLASH ||\n\t\t    code === SLASH_URL_SAFE)\n\t\t\treturn 63 // '/'\n\t\tif (code < NUMBER)\n\t\t\treturn -1 //no match\n\t\tif (code < NUMBER + 10)\n\t\t\treturn code - NUMBER + 26 + 26\n\t\tif (code < UPPER + 26)\n\t\t\treturn code - UPPER\n\t\tif (code < LOWER + 26)\n\t\t\treturn code - LOWER + 26\n\t}\n\n\tfunction b64ToByteArray (b64) {\n\t\tvar i, j, l, tmp, placeHolders, arr\n\n\t\tif (b64.length % 4 > 0) {\n\t\t\tthrow new Error('Invalid string. Length must be a multiple of 4')\n\t\t}\n\n\t\t// the number of equal signs (place holders)\n\t\t// if there are two placeholders, than the two characters before it\n\t\t// represent one byte\n\t\t// if there is only one, then the three characters before it represent 2 bytes\n\t\t// this is just a cheap hack to not do indexOf twice\n\t\tvar len = b64.length\n\t\tplaceHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0\n\n\t\t// base64 is 4/3 + up to two characters of the original data\n\t\tarr = new Arr(b64.length * 3 / 4 - placeHolders)\n\n\t\t// if there are placeholders, only get up to the last complete 4 chars\n\t\tl = placeHolders > 0 ? b64.length - 4 : b64.length\n\n\t\tvar L = 0\n\n\t\tfunction push (v) {\n\t\t\tarr[L++] = v\n\t\t}\n\n\t\tfor (i = 0, j = 0; i < l; i += 4, j += 3) {\n\t\t\ttmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))\n\t\t\tpush((tmp & 0xFF0000) >> 16)\n\t\t\tpush((tmp & 0xFF00) >> 8)\n\t\t\tpush(tmp & 0xFF)\n\t\t}\n\n\t\tif (placeHolders === 2) {\n\t\t\ttmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)\n\t\t\tpush(tmp & 0xFF)\n\t\t} else if (placeHolders === 1) {\n\t\t\ttmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)\n\t\t\tpush((tmp >> 8) & 0xFF)\n\t\t\tpush(tmp & 0xFF)\n\t\t}\n\n\t\treturn arr\n\t}\n\n\tfunction uint8ToBase64 (uint8) {\n\t\tvar i,\n\t\t\textraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes\n\t\t\toutput = \"\",\n\t\t\ttemp, length\n\n\t\tfunction encode (num) {\n\t\t\treturn lookup.charAt(num)\n\t\t}\n\n\t\tfunction tripletToBase64 (num) {\n\t\t\treturn encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)\n\t\t}\n\n\t\t// go through the array every three bytes, we'll deal with trailing stuff later\n\t\tfor (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {\n\t\t\ttemp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])\n\t\t\toutput += tripletToBase64(temp)\n\t\t}\n\n\t\t// pad the end with zeros, but make sure to not forget the extra bytes\n\t\tswitch (extraBytes) {\n\t\t\tcase 1:\n\t\t\t\ttemp = uint8[uint8.length - 1]\n\t\t\t\toutput += encode(temp >> 2)\n\t\t\t\toutput += encode((temp << 4) & 0x3F)\n\t\t\t\toutput += '=='\n\t\t\t\tbreak\n\t\t\tcase 2:\n\t\t\t\ttemp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])\n\t\t\t\toutput += encode(temp >> 10)\n\t\t\t\toutput += encode((temp >> 4) & 0x3F)\n\t\t\t\toutput += encode((temp << 2) & 0x3F)\n\t\t\t\toutput += '='\n\t\t\t\tbreak\n\t\t}\n\n\t\treturn output\n\t}\n\n\texports.toByteArray = b64ToByteArray\n\texports.fromByteArray = uint8ToBase64\n}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))\n\n},{}],3:[function(require,module,exports){\nexports.read = function (buffer, offset, isLE, mLen, nBytes) {\n  var e, m,\n      eLen = nBytes * 8 - mLen - 1,\n      eMax = (1 << eLen) - 1,\n      eBias = eMax >> 1,\n      nBits = -7,\n      i = isLE ? (nBytes - 1) : 0,\n      d = isLE ? -1 : 1,\n      s = buffer[offset + i]\n\n  i += d\n\n  e = s & ((1 << (-nBits)) - 1)\n  s >>= (-nBits)\n  nBits += eLen\n  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}\n\n  m = e & ((1 << (-nBits)) - 1)\n  e >>= (-nBits)\n  nBits += mLen\n  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}\n\n  if (e === 0) {\n    e = 1 - eBias\n  } else if (e === eMax) {\n    return m ? NaN : ((s ? -1 : 1) * Infinity)\n  } else {\n    m = m + Math.pow(2, mLen)\n    e = e - eBias\n  }\n  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)\n}\n\nexports.write = function (buffer, value, offset, isLE, mLen, nBytes) {\n  var e, m, c,\n      eLen = nBytes * 8 - mLen - 1,\n      eMax = (1 << eLen) - 1,\n      eBias = eMax >> 1,\n      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),\n      i = isLE ? 0 : (nBytes - 1),\n      d = isLE ? 1 : -1,\n      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0\n\n  value = Math.abs(value)\n\n  if (isNaN(value) || value === Infinity) {\n    m = isNaN(value) ? 1 : 0\n    e = eMax\n  } else {\n    e = Math.floor(Math.log(value) / Math.LN2)\n    if (value * (c = Math.pow(2, -e)) < 1) {\n      e--\n      c *= 2\n    }\n    if (e + eBias >= 1) {\n      value += rt / c\n    } else {\n      value += rt * Math.pow(2, 1 - eBias)\n    }\n    if (value * c >= 2) {\n      e++\n      c /= 2\n    }\n\n    if (e + eBias >= eMax) {\n      m = 0\n      e = eMax\n    } else if (e + eBias >= 1) {\n      m = (value * c - 1) * Math.pow(2, mLen)\n      e = e + eBias\n    } else {\n      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)\n      e = 0\n    }\n  }\n\n  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}\n\n  e = (e << mLen) | m\n  eLen += mLen\n  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}\n\n  buffer[offset + i - d] |= s * 128\n}\n\n},{}],4:[function(require,module,exports){\n\n/**\n * isArray\n */\n\nvar isArray = Array.isArray;\n\n/**\n * toString\n */\n\nvar str = Object.prototype.toString;\n\n/**\n * Whether or not the given `val`\n * is an array.\n *\n * example:\n *\n *        isArray([]);\n *        // > true\n *        isArray(arguments);\n *        // > false\n *        isArray('');\n *        // > false\n *\n * @param {mixed} val\n * @return {bool}\n */\n\nmodule.exports = isArray || function (val) {\n  return !! val && '[object Array]' == str.call(val);\n};\n\n},{}],5:[function(require,module,exports){\n(function (Buffer){\n// Generated by CoffeeScript 1.7.1\nvar UnicodeTrie, pako;\n\npako = require('pako/lib/inflate');\n\nUnicodeTrie = (function() {\n  var DATA_BLOCK_LENGTH, DATA_GRANULARITY, DATA_MASK, INDEX_1_OFFSET, INDEX_2_BLOCK_LENGTH, INDEX_2_BMP_LENGTH, INDEX_2_MASK, INDEX_SHIFT, LSCP_INDEX_2_LENGTH, LSCP_INDEX_2_OFFSET, OMITTED_BMP_INDEX_1_LENGTH, SHIFT_1, SHIFT_1_2, SHIFT_2, UTF8_2B_INDEX_2_LENGTH, UTF8_2B_INDEX_2_OFFSET;\n\n  SHIFT_1 = 6 + 5;\n\n  SHIFT_2 = 5;\n\n  SHIFT_1_2 = SHIFT_1 - SHIFT_2;\n\n  OMITTED_BMP_INDEX_1_LENGTH = 0x10000 >> SHIFT_1;\n\n  INDEX_2_BLOCK_LENGTH = 1 << SHIFT_1_2;\n\n  INDEX_2_MASK = INDEX_2_BLOCK_LENGTH - 1;\n\n  INDEX_SHIFT = 2;\n\n  DATA_BLOCK_LENGTH = 1 << SHIFT_2;\n\n  DATA_MASK = DATA_BLOCK_LENGTH - 1;\n\n  LSCP_INDEX_2_OFFSET = 0x10000 >> SHIFT_2;\n\n  LSCP_INDEX_2_LENGTH = 0x400 >> SHIFT_2;\n\n  INDEX_2_BMP_LENGTH = LSCP_INDEX_2_OFFSET + LSCP_INDEX_2_LENGTH;\n\n  UTF8_2B_INDEX_2_OFFSET = INDEX_2_BMP_LENGTH;\n\n  UTF8_2B_INDEX_2_LENGTH = 0x800 >> 6;\n\n  INDEX_1_OFFSET = UTF8_2B_INDEX_2_OFFSET + UTF8_2B_INDEX_2_LENGTH;\n\n  DATA_GRANULARITY = 1 << INDEX_SHIFT;\n\n  function UnicodeTrie(data) {\n    var length;\n    if (Buffer.isBuffer(data)) {\n      this.highStart = data.readUInt32BE(0);\n      this.errorValue = data.readUInt32BE(4);\n      length = data.readUInt32BE(8);\n      data = data.slice(12);\n      data = pako.inflateRaw(data);\n      data = pako.inflateRaw(data);\n      this.data = new Uint32Array(data.buffer);\n    } else {\n      this.data = data.data, this.highStart = data.highStart, this.errorValue = data.errorValue;\n    }\n  }\n\n  UnicodeTrie.prototype.get = function(codePoint) {\n    var index;\n    if (codePoint < 0 || codePoint > 0x10ffff) {\n      return this.errorValue;\n    }\n    if (codePoint < 0xd800 || (codePoint > 0xdbff && codePoint <= 0xffff)) {\n      index = (this.data[codePoint >> SHIFT_2] << INDEX_SHIFT) + (codePoint & DATA_MASK);\n      return this.data[index];\n    }\n    if (codePoint <= 0xffff) {\n      index = (this.data[LSCP_INDEX_2_OFFSET + ((codePoint - 0xd800) >> SHIFT_2)] << INDEX_SHIFT) + (codePoint & DATA_MASK);\n      return this.data[index];\n    }\n    if (codePoint < this.highStart) {\n      index = this.data[(INDEX_1_OFFSET - OMITTED_BMP_INDEX_1_LENGTH) + (codePoint >> SHIFT_1)];\n      index = this.data[index + ((codePoint >> SHIFT_2) & INDEX_2_MASK)];\n      index = (index << INDEX_SHIFT) + (codePoint & DATA_MASK);\n      return this.data[index];\n    }\n    return this.data[this.data.length - DATA_GRANULARITY];\n  };\n\n  return UnicodeTrie;\n\n})();\n\nmodule.exports = UnicodeTrie;\n\n}).call(this,require(\"buffer\").Buffer)\n},{\"buffer\":1,\"pako/lib/inflate\":6}],6:[function(require,module,exports){\n'use strict';\n\n\nvar zlib_inflate = require('./zlib/inflate.js');\nvar utils = require('./utils/common');\nvar strings = require('./utils/strings');\nvar c = require('./zlib/constants');\nvar msg = require('./zlib/messages');\nvar zstream = require('./zlib/zstream');\nvar gzheader = require('./zlib/gzheader');\n\nvar toString = Object.prototype.toString;\n\n/**\n * class Inflate\n *\n * Generic JS-style wrapper for zlib calls. If you don't need\n * streaming behaviour - use more simple functions: [[inflate]]\n * and [[inflateRaw]].\n **/\n\n/* internal\n * inflate.chunks -> Array\n *\n * Chunks of output data, if [[Inflate#onData]] not overriden.\n **/\n\n/**\n * Inflate.result -> Uint8Array|Array|String\n *\n * Uncompressed result, generated by default [[Inflate#onData]]\n * and [[Inflate#onEnd]] handlers. Filled after you push last chunk\n * (call [[Inflate#push]] with `Z_FINISH` / `true` param).\n **/\n\n/**\n * Inflate.err -> Number\n *\n * Error code after inflate finished. 0 (Z_OK) on success.\n * Should be checked if broken data possible.\n **/\n\n/**\n * Inflate.msg -> String\n *\n * Error message, if [[Inflate.err]] != 0\n **/\n\n\n/**\n * new Inflate(options)\n * - options (Object): zlib inflate options.\n *\n * Creates new inflator instance with specified params. Throws exception\n * on bad params. Supported options:\n *\n * - `windowBits`\n *\n * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)\n * for more information on these.\n *\n * Additional options, for internal needs:\n *\n * - `chunkSize` - size of generated data chunks (16K by default)\n * - `raw` (Boolean) - do raw inflate\n * - `to` (String) - if equal to 'string', then result will be converted\n *   from utf8 to utf16 (javascript) string. When string output requested,\n *   chunk length can differ from `chunkSize`, depending on content.\n *\n * By default, when no options set, autodetect deflate/gzip data format via\n * wrapper header.\n *\n * ##### Example:\n *\n * ```javascript\n * var pako = require('pako')\n *   , chunk1 = Uint8Array([1,2,3,4,5,6,7,8,9])\n *   , chunk2 = Uint8Array([10,11,12,13,14,15,16,17,18,19]);\n *\n * var inflate = new pako.Inflate({ level: 3});\n *\n * inflate.push(chunk1, false);\n * inflate.push(chunk2, true);  // true -> last chunk\n *\n * if (inflate.err) { throw new Error(inflate.err); }\n *\n * console.log(inflate.result);\n * ```\n **/\nvar Inflate = function(options) {\n\n  this.options = utils.assign({\n    chunkSize: 16384,\n    windowBits: 0,\n    to: ''\n  }, options || {});\n\n  var opt = this.options;\n\n  // Force window size for `raw` data, if not set directly,\n  // because we have no header for autodetect.\n  if (opt.raw && (opt.windowBits >= 0) && (opt.windowBits < 16)) {\n    opt.windowBits = -opt.windowBits;\n    if (opt.windowBits === 0) { opt.windowBits = -15; }\n  }\n\n  // If `windowBits` not defined (and mode not raw) - set autodetect flag for gzip/deflate\n  if ((opt.windowBits >= 0) && (opt.windowBits < 16) &&\n      !(options && options.windowBits)) {\n    opt.windowBits += 32;\n  }\n\n  // Gzip header has no info about windows size, we can do autodetect only\n  // for deflate. So, if window size not set, force it to max when gzip possible\n  if ((opt.windowBits > 15) && (opt.windowBits < 48)) {\n    // bit 3 (16) -> gzipped data\n    // bit 4 (32) -> autodetect gzip/deflate\n    if ((opt.windowBits & 15) === 0) {\n      opt.windowBits |= 15;\n    }\n  }\n\n  this.err    = 0;      // error code, if happens (0 = Z_OK)\n  this.msg    = '';     // error message\n  this.ended  = false;  // used to avoid multiple onEnd() calls\n  this.chunks = [];     // chunks of compressed data\n\n  this.strm   = new zstream();\n  this.strm.avail_out = 0;\n\n  var status  = zlib_inflate.inflateInit2(\n    this.strm,\n    opt.windowBits\n  );\n\n  if (status !== c.Z_OK) {\n    throw new Error(msg[status]);\n  }\n\n  this.header = new gzheader();\n\n  zlib_inflate.inflateGetHeader(this.strm, this.header);\n};\n\n/**\n * Inflate#push(data[, mode]) -> Boolean\n * - data (Uint8Array|Array|ArrayBuffer|String): input data\n * - mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.\n *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` meansh Z_FINISH.\n *\n * Sends input data to inflate pipe, generating [[Inflate#onData]] calls with\n * new output chunks. Returns `true` on success. The last data block must have\n * mode Z_FINISH (or `true`). That flush internal pending buffers and call\n * [[Inflate#onEnd]].\n *\n * On fail call [[Inflate#onEnd]] with error code and return false.\n *\n * We strongly recommend to use `Uint8Array` on input for best speed (output\n * format is detected automatically). Also, don't skip last param and always\n * use the same type in your code (boolean or number). That will improve JS speed.\n *\n * For regular `Array`-s make sure all elements are [0..255].\n *\n * ##### Example\n *\n * ```javascript\n * push(chunk, false); // push one of data chunks\n * ...\n * push(chunk, true);  // push last chunk\n * ```\n **/\nInflate.prototype.push = function(data, mode) {\n  var strm = this.strm;\n  var chunkSize = this.options.chunkSize;\n  var status, _mode;\n  var next_out_utf8, tail, utf8str;\n\n  if (this.ended) { return false; }\n  _mode = (mode === ~~mode) ? mode : ((mode === true) ? c.Z_FINISH : c.Z_NO_FLUSH);\n\n  // Convert data if needed\n  if (typeof data === 'string') {\n    // Only binary strings can be decompressed on practice\n    strm.input = strings.binstring2buf(data);\n  } else if (toString.call(data) === '[object ArrayBuffer]') {\n    strm.input = new Uint8Array(data);\n  } else {\n    strm.input = data;\n  }\n\n  strm.next_in = 0;\n  strm.avail_in = strm.input.length;\n\n  do {\n    if (strm.avail_out === 0) {\n      strm.output = new utils.Buf8(chunkSize);\n      strm.next_out = 0;\n      strm.avail_out = chunkSize;\n    }\n\n    status = zlib_inflate.inflate(strm, c.Z_NO_FLUSH);    /* no bad return value */\n\n    if (status !== c.Z_STREAM_END && status !== c.Z_OK) {\n      this.onEnd(status);\n      this.ended = true;\n      return false;\n    }\n\n    if (strm.next_out) {\n      if (strm.avail_out === 0 || status === c.Z_STREAM_END || (strm.avail_in === 0 && _mode === c.Z_FINISH)) {\n\n        if (this.options.to === 'string') {\n\n          next_out_utf8 = strings.utf8border(strm.output, strm.next_out);\n\n          tail = strm.next_out - next_out_utf8;\n          utf8str = strings.buf2string(strm.output, next_out_utf8);\n\n          // move tail\n          strm.next_out = tail;\n          strm.avail_out = chunkSize - tail;\n          if (tail) { utils.arraySet(strm.output, strm.output, next_out_utf8, tail, 0); }\n\n          this.onData(utf8str);\n\n        } else {\n          this.onData(utils.shrinkBuf(strm.output, strm.next_out));\n        }\n      }\n    }\n  } while ((strm.avail_in > 0) && status !== c.Z_STREAM_END);\n\n  if (status === c.Z_STREAM_END) {\n    _mode = c.Z_FINISH;\n  }\n  // Finalize on the last chunk.\n  if (_mode === c.Z_FINISH) {\n    status = zlib_inflate.inflateEnd(this.strm);\n    this.onEnd(status);\n    this.ended = true;\n    return status === c.Z_OK;\n  }\n\n  return true;\n};\n\n\n/**\n * Inflate#onData(chunk) -> Void\n * - chunk (Uint8Array|Array|String): ouput data. Type of array depends\n *   on js engine support. When string output requested, each chunk\n *   will be string.\n *\n * By default, stores data blocks in `chunks[]` property and glue\n * those in `onEnd`. Override this handler, if you need another behaviour.\n **/\nInflate.prototype.onData = function(chunk) {\n  this.chunks.push(chunk);\n};\n\n\n/**\n * Inflate#onEnd(status) -> Void\n * - status (Number): inflate status. 0 (Z_OK) on success,\n *   other if not.\n *\n * Called once after you tell inflate that input stream complete\n * or error happenned. By default - join collected chunks,\n * free memory and fill `results` / `err` properties.\n **/\nInflate.prototype.onEnd = function(status) {\n  // On success - join\n  if (status === c.Z_OK) {\n    if (this.options.to === 'string') {\n      // Glue & convert here, until we teach pako to send\n      // utf8 alligned strings to onData\n      this.result = this.chunks.join('');\n    } else {\n      this.result = utils.flattenChunks(this.chunks);\n    }\n  }\n  this.chunks = [];\n  this.err = status;\n  this.msg = this.strm.msg;\n};\n\n\n/**\n * inflate(data[, options]) -> Uint8Array|Array|String\n * - data (Uint8Array|Array|String): input data to decompress.\n * - options (Object): zlib inflate options.\n *\n * Decompress `data` with inflate/ungzip and `options`. Autodetect\n * format via wrapper header by default. That's why we don't provide\n * separate `ungzip` method.\n *\n * Supported options are:\n *\n * - windowBits\n *\n * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)\n * for more information.\n *\n * Sugar (options):\n *\n * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify\n *   negative windowBits implicitly.\n * - `to` (String) - if equal to 'string', then result will be converted\n *   from utf8 to utf16 (javascript) string. When string output requested,\n *   chunk length can differ from `chunkSize`, depending on content.\n *\n *\n * ##### Example:\n *\n * ```javascript\n * var pako = require('pako')\n *   , input = pako.deflate([1,2,3,4,5,6,7,8,9])\n *   , output;\n *\n * try {\n *   output = pako.inflate(input);\n * } catch (err)\n *   console.log(err);\n * }\n * ```\n **/\nfunction inflate(input, options) {\n  var inflator = new Inflate(options);\n\n  inflator.push(input, true);\n\n  // That will never happens, if you don't cheat with options :)\n  if (inflator.err) { throw inflator.msg; }\n\n  return inflator.result;\n}\n\n\n/**\n * inflateRaw(data[, options]) -> Uint8Array|Array|String\n * - data (Uint8Array|Array|String): input data to decompress.\n * - options (Object): zlib inflate options.\n *\n * The same as [[inflate]], but creates raw data, without wrapper\n * (header and adler32 crc).\n **/\nfunction inflateRaw(input, options) {\n  options = options || {};\n  options.raw = true;\n  return inflate(input, options);\n}\n\n\n/**\n * ungzip(data[, options]) -> Uint8Array|Array|String\n * - data (Uint8Array|Array|String): input data to decompress.\n * - options (Object): zlib inflate options.\n *\n * Just shortcut to [[inflate]], because it autodetects format\n * by header.content. Done for convenience.\n **/\n\n\nexports.Inflate = Inflate;\nexports.inflate = inflate;\nexports.inflateRaw = inflateRaw;\nexports.ungzip  = inflate;\n\n},{\"./utils/common\":7,\"./utils/strings\":8,\"./zlib/constants\":10,\"./zlib/gzheader\":12,\"./zlib/inflate.js\":14,\"./zlib/messages\":16,\"./zlib/zstream\":17}],7:[function(require,module,exports){\n'use strict';\n\n\nvar TYPED_OK =  (typeof Uint8Array !== 'undefined') &&\n                (typeof Uint16Array !== 'undefined') &&\n                (typeof Int32Array !== 'undefined');\n\n\nexports.assign = function (obj /*from1, from2, from3, ...*/) {\n  var sources = Array.prototype.slice.call(arguments, 1);\n  while (sources.length) {\n    var source = sources.shift();\n    if (!source) { continue; }\n\n    if (typeof(source) !== 'object') {\n      throw new TypeError(source + 'must be non-object');\n    }\n\n    for (var p in source) {\n      if (source.hasOwnProperty(p)) {\n        obj[p] = source[p];\n      }\n    }\n  }\n\n  return obj;\n};\n\n\n// reduce buffer size, avoiding mem copy\nexports.shrinkBuf = function (buf, size) {\n  if (buf.length === size) { return buf; }\n  if (buf.subarray) { return buf.subarray(0, size); }\n  buf.length = size;\n  return buf;\n};\n\n\nvar fnTyped = {\n  arraySet: function (dest, src, src_offs, len, dest_offs) {\n    if (src.subarray && dest.subarray) {\n      dest.set(src.subarray(src_offs, src_offs+len), dest_offs);\n      return;\n    }\n    // Fallback to ordinary array\n    for(var i=0; i<len; i++) {\n      dest[dest_offs + i] = src[src_offs + i];\n    }\n  },\n  // Join array of chunks to single array.\n  flattenChunks: function(chunks) {\n    var i, l, len, pos, chunk, result;\n\n    // calculate data length\n    len = 0;\n    for (i=0, l=chunks.length; i<l; i++) {\n      len += chunks[i].length;\n    }\n\n    // join chunks\n    result = new Uint8Array(len);\n    pos = 0;\n    for (i=0, l=chunks.length; i<l; i++) {\n      chunk = chunks[i];\n      result.set(chunk, pos);\n      pos += chunk.length;\n    }\n\n    return result;\n  }\n};\n\nvar fnUntyped = {\n  arraySet: function (dest, src, src_offs, len, dest_offs) {\n    for(var i=0; i<len; i++) {\n      dest[dest_offs + i] = src[src_offs + i];\n    }\n  },\n  // Join array of chunks to single array.\n  flattenChunks: function(chunks) {\n    return [].concat.apply([], chunks);\n  }\n};\n\n\n// Enable/Disable typed arrays use, for testing\n//\nexports.setTyped = function (on) {\n  if (on) {\n    exports.Buf8  = Uint8Array;\n    exports.Buf16 = Uint16Array;\n    exports.Buf32 = Int32Array;\n    exports.assign(exports, fnTyped);\n  } else {\n    exports.Buf8  = Array;\n    exports.Buf16 = Array;\n    exports.Buf32 = Array;\n    exports.assign(exports, fnUntyped);\n  }\n};\n\nexports.setTyped(TYPED_OK);\n},{}],8:[function(require,module,exports){\n// String encode/decode helpers\n'use strict';\n\n\nvar utils = require('./common');\n\n\n// Quick check if we can use fast array to bin string conversion\n//\n// - apply(Array) can fail on Android 2.2\n// - apply(Uint8Array) can fail on iOS 5.1 Safary\n//\nvar STR_APPLY_OK = true;\nvar STR_APPLY_UIA_OK = true;\n\ntry { String.fromCharCode.apply(null, [0]); } catch(__) { STR_APPLY_OK = false; }\ntry { String.fromCharCode.apply(null, new Uint8Array(1)); } catch(__) { STR_APPLY_UIA_OK = false; }\n\n\n// Table with utf8 lengths (calculated by first byte of sequence)\n// Note, that 5 & 6-byte values and some 4-byte values can not be represented in JS,\n// because max possible codepoint is 0x10ffff\nvar _utf8len = new utils.Buf8(256);\nfor (var i=0; i<256; i++) {\n  _utf8len[i] = (i >= 252 ? 6 : i >= 248 ? 5 : i >= 240 ? 4 : i >= 224 ? 3 : i >= 192 ? 2 : 1);\n}\n_utf8len[254]=_utf8len[254]=1; // Invalid sequence start\n\n\n// convert string to array (typed, when possible)\nexports.string2buf = function (str) {\n  var buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;\n\n  // count binary size\n  for (m_pos = 0; m_pos < str_len; m_pos++) {\n    c = str.charCodeAt(m_pos);\n    if ((c & 0xfc00) === 0xd800 && (m_pos+1 < str_len)) {\n      c2 = str.charCodeAt(m_pos+1);\n      if ((c2 & 0xfc00) === 0xdc00) {\n        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);\n        m_pos++;\n      }\n    }\n    buf_len += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;\n  }\n\n  // allocate buffer\n  buf = new utils.Buf8(buf_len);\n\n  // convert\n  for (i=0, m_pos = 0; i < buf_len; m_pos++) {\n    c = str.charCodeAt(m_pos);\n    if ((c & 0xfc00) === 0xd800 && (m_pos+1 < str_len)) {\n      c2 = str.charCodeAt(m_pos+1);\n      if ((c2 & 0xfc00) === 0xdc00) {\n        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);\n        m_pos++;\n      }\n    }\n    if (c < 0x80) {\n      /* one byte */\n      buf[i++] = c;\n    } else if (c < 0x800) {\n      /* two bytes */\n      buf[i++] = 0xC0 | (c >>> 6);\n      buf[i++] = 0x80 | (c & 0x3f);\n    } else if (c < 0x10000) {\n      /* three bytes */\n      buf[i++] = 0xE0 | (c >>> 12);\n      buf[i++] = 0x80 | (c >>> 6 & 0x3f);\n      buf[i++] = 0x80 | (c & 0x3f);\n    } else {\n      /* four bytes */\n      buf[i++] = 0xf0 | (c >>> 18);\n      buf[i++] = 0x80 | (c >>> 12 & 0x3f);\n      buf[i++] = 0x80 | (c >>> 6 & 0x3f);\n      buf[i++] = 0x80 | (c & 0x3f);\n    }\n  }\n\n  return buf;\n};\n\n// Helper (used in 2 places)\nfunction buf2binstring(buf, len) {\n  // use fallback for big arrays to avoid stack overflow\n  if (len < 65537) {\n    if ((buf.subarray && STR_APPLY_UIA_OK) || (!buf.subarray && STR_APPLY_OK)) {\n      return String.fromCharCode.apply(null, utils.shrinkBuf(buf, len));\n    }\n  }\n\n  var result = '';\n  for(var i=0; i < len; i++) {\n    result += String.fromCharCode(buf[i]);\n  }\n  return result;\n}\n\n\n// Convert byte array to binary string\nexports.buf2binstring = function(buf) {\n  return buf2binstring(buf, buf.length);\n};\n\n\n// Convert binary string (typed, when possible)\nexports.binstring2buf = function(str) {\n  var buf = new utils.Buf8(str.length);\n  for(var i=0, len=buf.length; i < len; i++) {\n    buf[i] = str.charCodeAt(i);\n  }\n  return buf;\n};\n\n\n// convert array to string\nexports.buf2string = function (buf, max) {\n  var i, out, c, c_len;\n  var len = max || buf.length;\n\n  // Reserve max possible length (2 words per char)\n  // NB: by unknown reasons, Array is significantly faster for\n  //     String.fromCharCode.apply than Uint16Array.\n  var utf16buf = new Array(len*2);\n\n  for (out=0, i=0; i<len;) {\n    c = buf[i++];\n    // quick process ascii\n    if (c < 0x80) { utf16buf[out++] = c; continue; }\n\n    c_len = _utf8len[c];\n    // skip 5 & 6 byte codes\n    if (c_len > 4) { utf16buf[out++] = 0xfffd; i += c_len-1; continue; }\n\n    // apply mask on first byte\n    c &= c_len === 2 ? 0x1f : c_len === 3 ? 0x0f : 0x07;\n    // join the rest\n    while (c_len > 1 && i < len) {\n      c = (c << 6) | (buf[i++] & 0x3f);\n      c_len--;\n    }\n\n    // terminated by end of string?\n    if (c_len > 1) { utf16buf[out++] = 0xfffd; continue; }\n\n    if (c < 0x10000) {\n      utf16buf[out++] = c;\n    } else {\n      c -= 0x10000;\n      utf16buf[out++] = 0xd800 | ((c >> 10) & 0x3ff);\n      utf16buf[out++] = 0xdc00 | (c & 0x3ff);\n    }\n  }\n\n  return buf2binstring(utf16buf, out);\n};\n\n\n// Calculate max possible position in utf8 buffer,\n// that will not break sequence. If that's not possible\n// - (very small limits) return max size as is.\n//\n// buf[] - utf8 bytes array\n// max   - length limit (mandatory);\nexports.utf8border = function(buf, max) {\n  var pos;\n\n  max = max || buf.length;\n  if (max > buf.length) { max = buf.length; }\n\n  // go back from last position, until start of sequence found\n  pos = max-1;\n  while (pos >= 0 && (buf[pos] & 0xC0) === 0x80) { pos--; }\n\n  // Fuckup - very small and broken sequence,\n  // return max, because we should return something anyway.\n  if (pos < 0) { return max; }\n\n  // If we came to start of buffer - that means vuffer is too small,\n  // return max too.\n  if (pos === 0) { return max; }\n\n  return (pos + _utf8len[buf[pos]] > max) ? pos : max;\n};\n\n},{\"./common\":7}],9:[function(require,module,exports){\n'use strict';\n\n// Note: adler32 takes 12% for level 0 and 2% for level 6.\n// It doesn't worth to make additional optimizationa as in original.\n// Small size is preferable.\n\nfunction adler32(adler, buf, len, pos) {\n  var s1 = (adler & 0xffff) |0\n    , s2 = ((adler >>> 16) & 0xffff) |0\n    , n = 0;\n\n  while (len !== 0) {\n    // Set limit ~ twice less than 5552, to keep\n    // s2 in 31-bits, because we force signed ints.\n    // in other case %= will fail.\n    n = len > 2000 ? 2000 : len;\n    len -= n;\n\n    do {\n      s1 = (s1 + buf[pos++]) |0;\n      s2 = (s2 + s1) |0;\n    } while (--n);\n\n    s1 %= 65521;\n    s2 %= 65521;\n  }\n\n  return (s1 | (s2 << 16)) |0;\n}\n\n\nmodule.exports = adler32;\n},{}],10:[function(require,module,exports){\nmodule.exports = {\n\n  /* Allowed flush values; see deflate() and inflate() below for details */\n  Z_NO_FLUSH:         0,\n  Z_PARTIAL_FLUSH:    1,\n  Z_SYNC_FLUSH:       2,\n  Z_FULL_FLUSH:       3,\n  Z_FINISH:           4,\n  Z_BLOCK:            5,\n  Z_TREES:            6,\n\n  /* Return codes for the compression/decompression functions. Negative values\n  * are errors, positive values are used for special but normal events.\n  */\n  Z_OK:               0,\n  Z_STREAM_END:       1,\n  Z_NEED_DICT:        2,\n  Z_ERRNO:           -1,\n  Z_STREAM_ERROR:    -2,\n  Z_DATA_ERROR:      -3,\n  //Z_MEM_ERROR:     -4,\n  Z_BUF_ERROR:       -5,\n  //Z_VERSION_ERROR: -6,\n\n  /* compression levels */\n  Z_NO_COMPRESSION:         0,\n  Z_BEST_SPEED:             1,\n  Z_BEST_COMPRESSION:       9,\n  Z_DEFAULT_COMPRESSION:   -1,\n\n\n  Z_FILTERED:               1,\n  Z_HUFFMAN_ONLY:           2,\n  Z_RLE:                    3,\n  Z_FIXED:                  4,\n  Z_DEFAULT_STRATEGY:       0,\n\n  /* Possible values of the data_type field (though see inflate()) */\n  Z_BINARY:                 0,\n  Z_TEXT:                   1,\n  //Z_ASCII:                1, // = Z_TEXT (deprecated)\n  Z_UNKNOWN:                2,\n\n  /* The deflate compression method */\n  Z_DEFLATED:               8\n  //Z_NULL:                 null // Use -1 or null inline, depending on var type\n};\n},{}],11:[function(require,module,exports){\n'use strict';\n\n// Note: we can't get significant speed boost here.\n// So write code to minimize size - no pregenerated tables\n// and array tools dependencies.\n\n\n// Use ordinary array, since untyped makes no boost here\nfunction makeTable() {\n  var c, table = [];\n\n  for(var n =0; n < 256; n++){\n    c = n;\n    for(var k =0; k < 8; k++){\n      c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));\n    }\n    table[n] = c;\n  }\n\n  return table;\n}\n\n// Create table on load. Just 255 signed longs. Not a problem.\nvar crcTable = makeTable();\n\n\nfunction crc32(crc, buf, len, pos) {\n  var t = crcTable\n    , end = pos + len;\n\n  crc = crc ^ (-1);\n\n  for (var i = pos; i < end; i++ ) {\n    crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];\n  }\n\n  return (crc ^ (-1)); // >>> 0;\n}\n\n\nmodule.exports = crc32;\n},{}],12:[function(require,module,exports){\n'use strict';\n\n\nfunction GZheader() {\n  /* true if compressed data believed to be text */\n  this.text       = 0;\n  /* modification time */\n  this.time       = 0;\n  /* extra flags (not used when writing a gzip file) */\n  this.xflags     = 0;\n  /* operating system */\n  this.os         = 0;\n  /* pointer to extra field or Z_NULL if none */\n  this.extra      = null;\n  /* extra field length (valid if extra != Z_NULL) */\n  this.extra_len  = 0; // Actually, we don't need it in JS,\n                       // but leave for few code modifications\n\n  //\n  // Setup limits is not necessary because in js we should not preallocate memory \n  // for inflate use constant limit in 65536 bytes\n  //\n\n  /* space at extra (only when reading header) */\n  // this.extra_max  = 0;\n  /* pointer to zero-terminated file name or Z_NULL */\n  this.name       = '';\n  /* space at name (only when reading header) */\n  // this.name_max   = 0;\n  /* pointer to zero-terminated comment or Z_NULL */\n  this.comment    = '';\n  /* space at comment (only when reading header) */\n  // this.comm_max   = 0;\n  /* true if there was or will be a header crc */\n  this.hcrc       = 0;\n  /* true when done reading gzip header (not used when writing a gzip file) */\n  this.done       = false;\n}\n\nmodule.exports = GZheader;\n},{}],13:[function(require,module,exports){\n'use strict';\n\n// See state defs from inflate.js\nvar BAD = 30;       /* got a data error -- remain here until reset */\nvar TYPE = 12;      /* i: waiting for type bits, including last-flag bit */\n\n/*\n   Decode literal, length, and distance codes and write out the resulting\n   literal and match bytes until either not enough input or output is\n   available, an end-of-block is encountered, or a data error is encountered.\n   When large enough input and output buffers are supplied to inflate(), for\n   example, a 16K input buffer and a 64K output buffer, more than 95% of the\n   inflate execution time is spent in this routine.\n\n   Entry assumptions:\n\n        state.mode === LEN\n        strm.avail_in >= 6\n        strm.avail_out >= 258\n        start >= strm.avail_out\n        state.bits < 8\n\n   On return, state.mode is one of:\n\n        LEN -- ran out of enough output space or enough available input\n        TYPE -- reached end of block code, inflate() to interpret next block\n        BAD -- error in block data\n\n   Notes:\n\n    - The maximum input bits used by a length/distance pair is 15 bits for the\n      length code, 5 bits for the length extra, 15 bits for the distance code,\n      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.\n      Therefore if strm.avail_in >= 6, then there is enough input to avoid\n      checking for available input while decoding.\n\n    - The maximum bytes that a single length/distance pair can output is 258\n      bytes, which is the maximum length that can be coded.  inflate_fast()\n      requires strm.avail_out >= 258 for each loop to avoid checking for\n      output space.\n */\nmodule.exports = function inflate_fast(strm, start) {\n  var state;\n  var _in;                    /* local strm.input */\n  var last;                   /* have enough input while in < last */\n  var _out;                   /* local strm.output */\n  var beg;                    /* inflate()'s initial strm.output */\n  var end;                    /* while out < end, enough space available */\n//#ifdef INFLATE_STRICT\n  var dmax;                   /* maximum distance from zlib header */\n//#endif\n  var wsize;                  /* window size or zero if not using window */\n  var whave;                  /* valid bytes in the window */\n  var wnext;                  /* window write index */\n  var window;                 /* allocated sliding window, if wsize != 0 */\n  var hold;                   /* local strm.hold */\n  var bits;                   /* local strm.bits */\n  var lcode;                  /* local strm.lencode */\n  var dcode;                  /* local strm.distcode */\n  var lmask;                  /* mask for first level of length codes */\n  var dmask;                  /* mask for first level of distance codes */\n  var here;                   /* retrieved table entry */\n  var op;                     /* code bits, operation, extra bits, or */\n                              /*  window position, window bytes to copy */\n  var len;                    /* match length, unused bytes */\n  var dist;                   /* match distance */\n  var from;                   /* where to copy match from */\n  var from_source;\n\n\n  var input, output; // JS specific, because we have no pointers\n\n  /* copy state to local variables */\n  state = strm.state;\n  //here = state.here;\n  _in = strm.next_in;\n  input = strm.input;\n  last = _in + (strm.avail_in - 5);\n  _out = strm.next_out;\n  output = strm.output;\n  beg = _out - (start - strm.avail_out);\n  end = _out + (strm.avail_out - 257);\n//#ifdef INFLATE_STRICT\n  dmax = state.dmax;\n//#endif\n  wsize = state.wsize;\n  whave = state.whave;\n  wnext = state.wnext;\n  window = state.window;\n  hold = state.hold;\n  bits = state.bits;\n  lcode = state.lencode;\n  dcode = state.distcode;\n  lmask = (1 << state.lenbits) - 1;\n  dmask = (1 << state.distbits) - 1;\n\n\n  /* decode literals and length/distances until end-of-block or not enough\n     input data or output space */\n\n  top:\n  do {\n    if (bits < 15) {\n      hold += input[_in++] << bits;\n      bits += 8;\n      hold += input[_in++] << bits;\n      bits += 8;\n    }\n\n    here = lcode[hold & lmask];\n\n    dolen:\n    for (;;) { // Goto emulation\n      op = here >>> 24/*here.bits*/;\n      hold >>>= op;\n      bits -= op;\n      op = (here >>> 16) & 0xff/*here.op*/;\n      if (op === 0) {                          /* literal */\n        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?\n        //        \"inflate:         literal '%c'\\n\" :\n        //        \"inflate:         literal 0x%02x\\n\", here.val));\n        output[_out++] = here & 0xffff/*here.val*/;\n      }\n      else if (op & 16) {                     /* length base */\n        len = here & 0xffff/*here.val*/;\n        op &= 15;                           /* number of extra bits */\n        if (op) {\n          if (bits < op) {\n            hold += input[_in++] << bits;\n            bits += 8;\n          }\n          len += hold & ((1 << op) - 1);\n          hold >>>= op;\n          bits -= op;\n        }\n        //Tracevv((stderr, \"inflate:         length %u\\n\", len));\n        if (bits < 15) {\n          hold += input[_in++] << bits;\n          bits += 8;\n          hold += input[_in++] << bits;\n          bits += 8;\n        }\n        here = dcode[hold & dmask];\n\n        dodist:\n        for (;;) { // goto emulation\n          op = here >>> 24/*here.bits*/;\n          hold >>>= op;\n          bits -= op;\n          op = (here >>> 16) & 0xff/*here.op*/;\n\n          if (op & 16) {                      /* distance base */\n            dist = here & 0xffff/*here.val*/;\n            op &= 15;                       /* number of extra bits */\n            if (bits < op) {\n              hold += input[_in++] << bits;\n              bits += 8;\n              if (bits < op) {\n                hold += input[_in++] << bits;\n                bits += 8;\n              }\n            }\n            dist += hold & ((1 << op) - 1);\n//#ifdef INFLATE_STRICT\n            if (dist > dmax) {\n              strm.msg = 'invalid distance too far back';\n              state.mode = BAD;\n              break top;\n            }\n//#endif\n            hold >>>= op;\n            bits -= op;\n            //Tracevv((stderr, \"inflate:         distance %u\\n\", dist));\n            op = _out - beg;                /* max distance in output */\n            if (dist > op) {                /* see if copy from window */\n              op = dist - op;               /* distance back in window */\n              if (op > whave) {\n                if (state.sane) {\n                  strm.msg = 'invalid distance too far back';\n                  state.mode = BAD;\n                  break top;\n                }\n\n// (!) This block is disabled in zlib defailts,\n// don't enable it for binary compatibility\n//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR\n//                if (len <= op - whave) {\n//                  do {\n//                    output[_out++] = 0;\n//                  } while (--len);\n//                  continue top;\n//                }\n//                len -= op - whave;\n//                do {\n//                  output[_out++] = 0;\n//                } while (--op > whave);\n//                if (op === 0) {\n//                  from = _out - dist;\n//                  do {\n//                    output[_out++] = output[from++];\n//                  } while (--len);\n//                  continue top;\n//                }\n//#endif\n              }\n              from = 0; // window index\n              from_source = window;\n              if (wnext === 0) {           /* very common case */\n                from += wsize - op;\n                if (op < len) {         /* some from window */\n                  len -= op;\n                  do {\n                    output[_out++] = window[from++];\n                  } while (--op);\n                  from = _out - dist;  /* rest from output */\n                  from_source = output;\n                }\n              }\n              else if (wnext < op) {      /* wrap around window */\n                from += wsize + wnext - op;\n                op -= wnext;\n                if (op < len) {         /* some from end of window */\n                  len -= op;\n                  do {\n                    output[_out++] = window[from++];\n                  } while (--op);\n                  from = 0;\n                  if (wnext < len) {  /* some from start of window */\n                    op = wnext;\n                    len -= op;\n                    do {\n                      output[_out++] = window[from++];\n                    } while (--op);\n                    from = _out - dist;      /* rest from output */\n                    from_source = output;\n                  }\n                }\n              }\n              else {                      /* contiguous in window */\n                from += wnext - op;\n                if (op < len) {         /* some from window */\n                  len -= op;\n                  do {\n                    output[_out++] = window[from++];\n                  } while (--op);\n                  from = _out - dist;  /* rest from output */\n                  from_source = output;\n                }\n              }\n              while (len > 2) {\n                output[_out++] = from_source[from++];\n                output[_out++] = from_source[from++];\n                output[_out++] = from_source[from++];\n                len -= 3;\n              }\n              if (len) {\n                output[_out++] = from_source[from++];\n                if (len > 1) {\n                  output[_out++] = from_source[from++];\n                }\n              }\n            }\n            else {\n              from = _out - dist;          /* copy direct from output */\n              do {                        /* minimum length is three */\n                output[_out++] = output[from++];\n                output[_out++] = output[from++];\n                output[_out++] = output[from++];\n                len -= 3;\n              } while (len > 2);\n              if (len) {\n                output[_out++] = output[from++];\n                if (len > 1) {\n                  output[_out++] = output[from++];\n                }\n              }\n            }\n          }\n          else if ((op & 64) === 0) {          /* 2nd level distance code */\n            here = dcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];\n            continue dodist;\n          }\n          else {\n            strm.msg = 'invalid distance code';\n            state.mode = BAD;\n            break top;\n          }\n\n          break; // need to emulate goto via \"continue\"\n        }\n      }\n      else if ((op & 64) === 0) {              /* 2nd level length code */\n        here = lcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];\n        continue dolen;\n      }\n      else if (op & 32) {                     /* end-of-block */\n        //Tracevv((stderr, \"inflate:         end of block\\n\"));\n        state.mode = TYPE;\n        break top;\n      }\n      else {\n        strm.msg = 'invalid literal/length code';\n        state.mode = BAD;\n        break top;\n      }\n\n      break; // need to emulate goto via \"continue\"\n    }\n  } while (_in < last && _out < end);\n\n  /* return unused bytes (on entry, bits < 8, so in won't go too far back) */\n  len = bits >> 3;\n  _in -= len;\n  bits -= len << 3;\n  hold &= (1 << bits) - 1;\n\n  /* update state and return */\n  strm.next_in = _in;\n  strm.next_out = _out;\n  strm.avail_in = (_in < last ? 5 + (last - _in) : 5 - (_in - last));\n  strm.avail_out = (_out < end ? 257 + (end - _out) : 257 - (_out - end));\n  state.hold = hold;\n  state.bits = bits;\n  return;\n};\n\n},{}],14:[function(require,module,exports){\n'use strict';\n\n\nvar utils = require('../utils/common');\nvar adler32 = require('./adler32');\nvar crc32   = require('./crc32');\nvar inflate_fast = require('./inffast');\nvar inflate_table = require('./inftrees');\n\nvar CODES = 0;\nvar LENS = 1;\nvar DISTS = 2;\n\n/* Public constants ==========================================================*/\n/* ===========================================================================*/\n\n\n/* Allowed flush values; see deflate() and inflate() below for details */\n//var Z_NO_FLUSH      = 0;\n//var Z_PARTIAL_FLUSH = 1;\n//var Z_SYNC_FLUSH    = 2;\n//var Z_FULL_FLUSH    = 3;\nvar Z_FINISH        = 4;\nvar Z_BLOCK         = 5;\nvar Z_TREES         = 6;\n\n\n/* Return codes for the compression/decompression functions. Negative values\n * are errors, positive values are used for special but normal events.\n */\nvar Z_OK            = 0;\nvar Z_STREAM_END    = 1;\nvar Z_NEED_DICT     = 2;\n//var Z_ERRNO         = -1;\nvar Z_STREAM_ERROR  = -2;\nvar Z_DATA_ERROR    = -3;\nvar Z_MEM_ERROR     = -4;\nvar Z_BUF_ERROR     = -5;\n//var Z_VERSION_ERROR = -6;\n\n/* The deflate compression method */\nvar Z_DEFLATED  = 8;\n\n\n/* STATES ====================================================================*/\n/* ===========================================================================*/\n\n\nvar    HEAD = 1;       /* i: waiting for magic header */\nvar    FLAGS = 2;      /* i: waiting for method and flags (gzip) */\nvar    TIME = 3;       /* i: waiting for modification time (gzip) */\nvar    OS = 4;         /* i: waiting for extra flags and operating system (gzip) */\nvar    EXLEN = 5;      /* i: waiting for extra length (gzip) */\nvar    EXTRA = 6;      /* i: waiting for extra bytes (gzip) */\nvar    NAME = 7;       /* i: waiting for end of file name (gzip) */\nvar    COMMENT = 8;    /* i: waiting for end of comment (gzip) */\nvar    HCRC = 9;       /* i: waiting for header crc (gzip) */\nvar    DICTID = 10;    /* i: waiting for dictionary check value */\nvar    DICT = 11;      /* waiting for inflateSetDictionary() call */\nvar        TYPE = 12;      /* i: waiting for type bits, including last-flag bit */\nvar        TYPEDO = 13;    /* i: same, but skip check to exit inflate on new block */\nvar        STORED = 14;    /* i: waiting for stored size (length and complement) */\nvar        COPY_ = 15;     /* i/o: same as COPY below, but only first time in */\nvar        COPY = 16;      /* i/o: waiting for input or output to copy stored block */\nvar        TABLE = 17;     /* i: waiting for dynamic block table lengths */\nvar        LENLENS = 18;   /* i: waiting for code length code lengths */\nvar        CODELENS = 19;  /* i: waiting for length/lit and distance code lengths */\nvar            LEN_ = 20;      /* i: same as LEN below, but only first time in */\nvar            LEN = 21;       /* i: waiting for length/lit/eob code */\nvar            LENEXT = 22;    /* i: waiting for length extra bits */\nvar            DIST = 23;      /* i: waiting for distance code */\nvar            DISTEXT = 24;   /* i: waiting for distance extra bits */\nvar            MATCH = 25;     /* o: waiting for output space to copy string */\nvar            LIT = 26;       /* o: waiting for output space to write literal */\nvar    CHECK = 27;     /* i: waiting for 32-bit check value */\nvar    LENGTH = 28;    /* i: waiting for 32-bit length (gzip) */\nvar    DONE = 29;      /* finished check, done -- remain here until reset */\nvar    BAD = 30;       /* got a data error -- remain here until reset */\nvar    MEM = 31;       /* got an inflate() memory error -- remain here until reset */\nvar    SYNC = 32;      /* looking for synchronization bytes to restart inflate() */\n\n/* ===========================================================================*/\n\n\n\nvar ENOUGH_LENS = 852;\nvar ENOUGH_DISTS = 592;\n//var ENOUGH =  (ENOUGH_LENS+ENOUGH_DISTS);\n\nvar MAX_WBITS = 15;\n/* 32K LZ77 window */\nvar DEF_WBITS = MAX_WBITS;\n\n\nfunction ZSWAP32(q) {\n  return  (((q >>> 24) & 0xff) +\n          ((q >>> 8) & 0xff00) +\n          ((q & 0xff00) << 8) +\n          ((q & 0xff) << 24));\n}\n\n\nfunction InflateState() {\n  this.mode = 0;             /* current inflate mode */\n  this.last = false;          /* true if processing last block */\n  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */\n  this.havedict = false;      /* true if dictionary provided */\n  this.flags = 0;             /* gzip header method and flags (0 if zlib) */\n  this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */\n  this.check = 0;             /* protected copy of check value */\n  this.total = 0;             /* protected copy of output count */\n  // TODO: may be {}\n  this.head = null;           /* where to save gzip header information */\n\n  /* sliding window */\n  this.wbits = 0;             /* log base 2 of requested window size */\n  this.wsize = 0;             /* window size or zero if not using window */\n  this.whave = 0;             /* valid bytes in the window */\n  this.wnext = 0;             /* window write index */\n  this.window = null;         /* allocated sliding window, if needed */\n\n  /* bit accumulator */\n  this.hold = 0;              /* input bit accumulator */\n  this.bits = 0;              /* number of bits in \"in\" */\n\n  /* for string and stored block copying */\n  this.length = 0;            /* literal or length of data to copy */\n  this.offset = 0;            /* distance back to copy string from */\n\n  /* for table and code decoding */\n  this.extra = 0;             /* extra bits needed */\n\n  /* fixed and dynamic code tables */\n  this.lencode = null;          /* starting table for length/literal codes */\n  this.distcode = null;         /* starting table for distance codes */\n  this.lenbits = 0;           /* index bits for lencode */\n  this.distbits = 0;          /* index bits for distcode */\n\n  /* dynamic table building */\n  this.ncode = 0;             /* number of code length code lengths */\n  this.nlen = 0;              /* number of length code lengths */\n  this.ndist = 0;             /* number of distance code lengths */\n  this.have = 0;              /* number of code lengths in lens[] */\n  this.next = null;              /* next available space in codes[] */\n\n  this.lens = new utils.Buf16(320); /* temporary storage for code lengths */\n  this.work = new utils.Buf16(288); /* work area for code table building */\n\n  /*\n   because we don't have pointers in js, we use lencode and distcode directly\n   as buffers so we don't need codes\n  */\n  //this.codes = new utils.Buf32(ENOUGH);       /* space for code tables */\n  this.lendyn = null;              /* dynamic table for length/literal codes (JS specific) */\n  this.distdyn = null;             /* dynamic table for distance codes (JS specific) */\n  this.sane = 0;                   /* if false, allow invalid distance too far */\n  this.back = 0;                   /* bits back of last unprocessed length/lit */\n  this.was = 0;                    /* initial length of match */\n}\n\nfunction inflateResetKeep(strm) {\n  var state;\n\n  if (!strm || !strm.state) { return Z_STREAM_ERROR; }\n  state = strm.state;\n  strm.total_in = strm.total_out = state.total = 0;\n  strm.msg = ''; /*Z_NULL*/\n  if (state.wrap) {       /* to support ill-conceived Java test suite */\n    strm.adler = state.wrap & 1;\n  }\n  state.mode = HEAD;\n  state.last = 0;\n  state.havedict = 0;\n  state.dmax = 32768;\n  state.head = null/*Z_NULL*/;\n  state.hold = 0;\n  state.bits = 0;\n  //state.lencode = state.distcode = state.next = state.codes;\n  state.lencode = state.lendyn = new utils.Buf32(ENOUGH_LENS);\n  state.distcode = state.distdyn = new utils.Buf32(ENOUGH_DISTS);\n\n  state.sane = 1;\n  state.back = -1;\n  //Tracev((stderr, \"inflate: reset\\n\"));\n  return Z_OK;\n}\n\nfunction inflateReset(strm) {\n  var state;\n\n  if (!strm || !strm.state) { return Z_STREAM_ERROR; }\n  state = strm.state;\n  state.wsize = 0;\n  state.whave = 0;\n  state.wnext = 0;\n  return inflateResetKeep(strm);\n\n}\n\nfunction inflateReset2(strm, windowBits) {\n  var wrap;\n  var state;\n\n  /* get the state */\n  if (!strm || !strm.state) { return Z_STREAM_ERROR; }\n  state = strm.state;\n\n  /* extract wrap request from windowBits parameter */\n  if (windowBits < 0) {\n    wrap = 0;\n    windowBits = -windowBits;\n  }\n  else {\n    wrap = (windowBits >> 4) + 1;\n    if (windowBits < 48) {\n      windowBits &= 15;\n    }\n  }\n\n  /* set number of window bits, free window if different */\n  if (windowBits && (windowBits < 8 || windowBits > 15)) {\n    return Z_STREAM_ERROR;\n  }\n  if (state.window !== null && state.wbits !== windowBits) {\n    state.window = null;\n  }\n\n  /* update state and reset the rest of it */\n  state.wrap = wrap;\n  state.wbits = windowBits;\n  return inflateReset(strm);\n}\n\nfunction inflateInit2(strm, windowBits) {\n  var ret;\n  var state;\n\n  if (!strm) { return Z_STREAM_ERROR; }\n  //strm.msg = Z_NULL;                 /* in case we return an error */\n\n  state = new InflateState();\n\n  //if (state === Z_NULL) return Z_MEM_ERROR;\n  //Tracev((stderr, \"inflate: allocated\\n\"));\n  strm.state = state;\n  state.window = null/*Z_NULL*/;\n  ret = inflateReset2(strm, windowBits);\n  if (ret !== Z_OK) {\n    strm.state = null/*Z_NULL*/;\n  }\n  return ret;\n}\n\nfunction inflateInit(strm) {\n  return inflateInit2(strm, DEF_WBITS);\n}\n\n\n/*\n Return state with length and distance decoding tables and index sizes set to\n fixed code decoding.  Normally this returns fixed tables from inffixed.h.\n If BUILDFIXED is defined, then instead this routine builds the tables the\n first time it's called, and returns those tables the first time and\n thereafter.  This reduces the size of the code by about 2K bytes, in\n exchange for a little execution time.  However, BUILDFIXED should not be\n used for threaded applications, since the rewriting of the tables and virgin\n may not be thread-safe.\n */\nvar virgin = true;\n\nvar lenfix, distfix; // We have no pointers in JS, so keep tables separate\n\nfunction fixedtables(state) {\n  /* build fixed huffman tables if first call (may not be thread safe) */\n  if (virgin) {\n    var sym;\n\n    lenfix = new utils.Buf32(512);\n    distfix = new utils.Buf32(32);\n\n    /* literal/length table */\n    sym = 0;\n    while (sym < 144) { state.lens[sym++] = 8; }\n    while (sym < 256) { state.lens[sym++] = 9; }\n    while (sym < 280) { state.lens[sym++] = 7; }\n    while (sym < 288) { state.lens[sym++] = 8; }\n\n    inflate_table(LENS,  state.lens, 0, 288, lenfix,   0, state.work, {bits: 9});\n\n    /* distance table */\n    sym = 0;\n    while (sym < 32) { state.lens[sym++] = 5; }\n\n    inflate_table(DISTS, state.lens, 0, 32,   distfix, 0, state.work, {bits: 5});\n\n    /* do this just once */\n    virgin = false;\n  }\n\n  state.lencode = lenfix;\n  state.lenbits = 9;\n  state.distcode = distfix;\n  state.distbits = 5;\n}\n\n\n/*\n Update the window with the last wsize (normally 32K) bytes written before\n returning.  If window does not exist yet, create it.  This is only called\n when a window is already in use, or when output has been written during this\n inflate call, but the end of the deflate stream has not been reached yet.\n It is also called to create a window for dictionary data when a dictionary\n is loaded.\n\n Providing output buffers larger than 32K to inflate() should provide a speed\n advantage, since only the last 32K of output is copied to the sliding window\n upon return from inflate(), and since all distances after the first 32K of\n output will fall in the output data, making match copies simpler and faster.\n The advantage may be dependent on the size of the processor's data caches.\n */\nfunction updatewindow(strm, src, end, copy) {\n  var dist;\n  var state = strm.state;\n\n  /* if it hasn't been done already, allocate space for the window */\n  if (state.window === null) {\n    state.wsize = 1 << state.wbits;\n    state.wnext = 0;\n    state.whave = 0;\n\n    state.window = new utils.Buf8(state.wsize);\n  }\n\n  /* copy state->wsize or less output bytes into the circular window */\n  if (copy >= state.wsize) {\n    utils.arraySet(state.window,src, end - state.wsize, state.wsize, 0);\n    state.wnext = 0;\n    state.whave = state.wsize;\n  }\n  else {\n    dist = state.wsize - state.wnext;\n    if (dist > copy) {\n      dist = copy;\n    }\n    //zmemcpy(state->window + state->wnext, end - copy, dist);\n    utils.arraySet(state.window,src, end - copy, dist, state.wnext);\n    copy -= dist;\n    if (copy) {\n      //zmemcpy(state->window, end - copy, copy);\n      utils.arraySet(state.window,src, end - copy, copy, 0);\n      state.wnext = copy;\n      state.whave = state.wsize;\n    }\n    else {\n      state.wnext += dist;\n      if (state.wnext === state.wsize) { state.wnext = 0; }\n      if (state.whave < state.wsize) { state.whave += dist; }\n    }\n  }\n  return 0;\n}\n\nfunction inflate(strm, flush) {\n  var state;\n  var input, output;          // input/output buffers\n  var next;                   /* next input INDEX */\n  var put;                    /* next output INDEX */\n  var have, left;             /* available input and output */\n  var hold;                   /* bit buffer */\n  var bits;                   /* bits in bit buffer */\n  var _in, _out;              /* save starting available input and output */\n  var copy;                   /* number of stored or match bytes to copy */\n  var from;                   /* where to copy match bytes from */\n  var from_source;\n  var here = 0;               /* current decoding table entry */\n  var here_bits, here_op, here_val; // paked \"here\" denormalized (JS specific)\n  //var last;                   /* parent table entry */\n  var last_bits, last_op, last_val; // paked \"last\" denormalized (JS specific)\n  var len;                    /* length to copy for repeats, bits to drop */\n  var ret;                    /* return code */\n  var hbuf = new utils.Buf8(4);    /* buffer for gzip header crc calculation */\n  var opts;\n\n  var n; // temporary var for NEED_BITS\n\n  var order = /* permutation of code lengths */\n    [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];\n\n\n  if (!strm || !strm.state || !strm.output ||\n      (!strm.input && strm.avail_in !== 0)) {\n    return Z_STREAM_ERROR;\n  }\n\n  state = strm.state;\n  if (state.mode === TYPE) { state.mode = TYPEDO; }    /* skip check */\n\n\n  //--- LOAD() ---\n  put = strm.next_out;\n  output = strm.output;\n  left = strm.avail_out;\n  next = strm.next_in;\n  input = strm.input;\n  have = strm.avail_in;\n  hold = state.hold;\n  bits = state.bits;\n  //---\n\n  _in = have;\n  _out = left;\n  ret = Z_OK;\n\n  inf_leave: // goto emulation\n  for (;;) {\n    switch (state.mode) {\n    case HEAD:\n      if (state.wrap === 0) {\n        state.mode = TYPEDO;\n        break;\n      }\n      //=== NEEDBITS(16);\n      while (bits < 16) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      if ((state.wrap & 2) && hold === 0x8b1f) {  /* gzip header */\n        state.check = 0/*crc32(0L, Z_NULL, 0)*/;\n        //=== CRC2(state.check, hold);\n        hbuf[0] = hold & 0xff;\n        hbuf[1] = (hold >>> 8) & 0xff;\n        state.check = crc32(state.check, hbuf, 2, 0);\n        //===//\n\n        //=== INITBITS();\n        hold = 0;\n        bits = 0;\n        //===//\n        state.mode = FLAGS;\n        break;\n      }\n      state.flags = 0;           /* expect zlib header */\n      if (state.head) {\n        state.head.done = false;\n      }\n      if (!(state.wrap & 1) ||   /* check if zlib header allowed */\n        (((hold & 0xff)/*BITS(8)*/ << 8) + (hold >> 8)) % 31) {\n        strm.msg = 'incorrect header check';\n        state.mode = BAD;\n        break;\n      }\n      if ((hold & 0x0f)/*BITS(4)*/ !== Z_DEFLATED) {\n        strm.msg = 'unknown compression method';\n        state.mode = BAD;\n        break;\n      }\n      //--- DROPBITS(4) ---//\n      hold >>>= 4;\n      bits -= 4;\n      //---//\n      len = (hold & 0x0f)/*BITS(4)*/ + 8;\n      if (state.wbits === 0) {\n        state.wbits = len;\n      }\n      else if (len > state.wbits) {\n        strm.msg = 'invalid window size';\n        state.mode = BAD;\n        break;\n      }\n      state.dmax = 1 << len;\n      //Tracev((stderr, \"inflate:   zlib header ok\\n\"));\n      strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;\n      state.mode = hold & 0x200 ? DICTID : TYPE;\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      break;\n    case FLAGS:\n      //=== NEEDBITS(16); */\n      while (bits < 16) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      state.flags = hold;\n      if ((state.flags & 0xff) !== Z_DEFLATED) {\n        strm.msg = 'unknown compression method';\n        state.mode = BAD;\n        break;\n      }\n      if (state.flags & 0xe000) {\n        strm.msg = 'unknown header flags set';\n        state.mode = BAD;\n        break;\n      }\n      if (state.head) {\n        state.head.text = ((hold >> 8) & 1);\n      }\n      if (state.flags & 0x0200) {\n        //=== CRC2(state.check, hold);\n        hbuf[0] = hold & 0xff;\n        hbuf[1] = (hold >>> 8) & 0xff;\n        state.check = crc32(state.check, hbuf, 2, 0);\n        //===//\n      }\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      state.mode = TIME;\n      /* falls through */\n    case TIME:\n      //=== NEEDBITS(32); */\n      while (bits < 32) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      if (state.head) {\n        state.head.time = hold;\n      }\n      if (state.flags & 0x0200) {\n        //=== CRC4(state.check, hold)\n        hbuf[0] = hold & 0xff;\n        hbuf[1] = (hold >>> 8) & 0xff;\n        hbuf[2] = (hold >>> 16) & 0xff;\n        hbuf[3] = (hold >>> 24) & 0xff;\n        state.check = crc32(state.check, hbuf, 4, 0);\n        //===\n      }\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      state.mode = OS;\n      /* falls through */\n    case OS:\n      //=== NEEDBITS(16); */\n      while (bits < 16) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      if (state.head) {\n        state.head.xflags = (hold & 0xff);\n        state.head.os = (hold >> 8);\n      }\n      if (state.flags & 0x0200) {\n        //=== CRC2(state.check, hold);\n        hbuf[0] = hold & 0xff;\n        hbuf[1] = (hold >>> 8) & 0xff;\n        state.check = crc32(state.check, hbuf, 2, 0);\n        //===//\n      }\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      state.mode = EXLEN;\n      /* falls through */\n    case EXLEN:\n      if (state.flags & 0x0400) {\n        //=== NEEDBITS(16); */\n        while (bits < 16) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        state.length = hold;\n        if (state.head) {\n          state.head.extra_len = hold;\n        }\n        if (state.flags & 0x0200) {\n          //=== CRC2(state.check, hold);\n          hbuf[0] = hold & 0xff;\n          hbuf[1] = (hold >>> 8) & 0xff;\n          state.check = crc32(state.check, hbuf, 2, 0);\n          //===//\n        }\n        //=== INITBITS();\n        hold = 0;\n        bits = 0;\n        //===//\n      }\n      else if (state.head) {\n        state.head.extra = null/*Z_NULL*/;\n      }\n      state.mode = EXTRA;\n      /* falls through */\n    case EXTRA:\n      if (state.flags & 0x0400) {\n        copy = state.length;\n        if (copy > have) { copy = have; }\n        if (copy) {\n          if (state.head) {\n            len = state.head.extra_len - state.length;\n            if (!state.head.extra) {\n              // Use untyped array for more conveniend processing later\n              state.head.extra = new Array(state.head.extra_len);\n            }\n            utils.arraySet(\n              state.head.extra,\n              input,\n              next,\n              // extra field is limited to 65536 bytes\n              // - no need for additional size check\n              copy,\n              /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/\n              len\n            );\n            //zmemcpy(state.head.extra + len, next,\n            //        len + copy > state.head.extra_max ?\n            //        state.head.extra_max - len : copy);\n          }\n          if (state.flags & 0x0200) {\n            state.check = crc32(state.check, input, copy, next);\n          }\n          have -= copy;\n          next += copy;\n          state.length -= copy;\n        }\n        if (state.length) { break inf_leave; }\n      }\n      state.length = 0;\n      state.mode = NAME;\n      /* falls through */\n    case NAME:\n      if (state.flags & 0x0800) {\n        if (have === 0) { break inf_leave; }\n        copy = 0;\n        do {\n          // TODO: 2 or 1 bytes?\n          len = input[next + copy++];\n          /* use constant limit because in js we should not preallocate memory */\n          if (state.head && len &&\n              (state.length < 65536 /*state.head.name_max*/)) {\n            state.head.name += String.fromCharCode(len);\n          }\n        } while (len && copy < have);\n\n        if (state.flags & 0x0200) {\n          state.check = crc32(state.check, input, copy, next);\n        }\n        have -= copy;\n        next += copy;\n        if (len) { break inf_leave; }\n      }\n      else if (state.head) {\n        state.head.name = null;\n      }\n      state.length = 0;\n      state.mode = COMMENT;\n      /* falls through */\n    case COMMENT:\n      if (state.flags & 0x1000) {\n        if (have === 0) { break inf_leave; }\n        copy = 0;\n        do {\n          len = input[next + copy++];\n          /* use constant limit because in js we should not preallocate memory */\n          if (state.head && len &&\n              (state.length < 65536 /*state.head.comm_max*/)) {\n            state.head.comment += String.fromCharCode(len);\n          }\n        } while (len && copy < have);\n        if (state.flags & 0x0200) {\n          state.check = crc32(state.check, input, copy, next);\n        }\n        have -= copy;\n        next += copy;\n        if (len) { break inf_leave; }\n      }\n      else if (state.head) {\n        state.head.comment = null;\n      }\n      state.mode = HCRC;\n      /* falls through */\n    case HCRC:\n      if (state.flags & 0x0200) {\n        //=== NEEDBITS(16); */\n        while (bits < 16) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        if (hold !== (state.check & 0xffff)) {\n          strm.msg = 'header crc mismatch';\n          state.mode = BAD;\n          break;\n        }\n        //=== INITBITS();\n        hold = 0;\n        bits = 0;\n        //===//\n      }\n      if (state.head) {\n        state.head.hcrc = ((state.flags >> 9) & 1);\n        state.head.done = true;\n      }\n      strm.adler = state.check = 0 /*crc32(0L, Z_NULL, 0)*/;\n      state.mode = TYPE;\n      break;\n    case DICTID:\n      //=== NEEDBITS(32); */\n      while (bits < 32) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      strm.adler = state.check = ZSWAP32(hold);\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      state.mode = DICT;\n      /* falls through */\n    case DICT:\n      if (state.havedict === 0) {\n        //--- RESTORE() ---\n        strm.next_out = put;\n        strm.avail_out = left;\n        strm.next_in = next;\n        strm.avail_in = have;\n        state.hold = hold;\n        state.bits = bits;\n        //---\n        return Z_NEED_DICT;\n      }\n      strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;\n      state.mode = TYPE;\n      /* falls through */\n    case TYPE:\n      if (flush === Z_BLOCK || flush === Z_TREES) { break inf_leave; }\n      /* falls through */\n    case TYPEDO:\n      if (state.last) {\n        //--- BYTEBITS() ---//\n        hold >>>= bits & 7;\n        bits -= bits & 7;\n        //---//\n        state.mode = CHECK;\n        break;\n      }\n      //=== NEEDBITS(3); */\n      while (bits < 3) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      state.last = (hold & 0x01)/*BITS(1)*/;\n      //--- DROPBITS(1) ---//\n      hold >>>= 1;\n      bits -= 1;\n      //---//\n\n      switch ((hold & 0x03)/*BITS(2)*/) {\n      case 0:                             /* stored block */\n        //Tracev((stderr, \"inflate:     stored block%s\\n\",\n        //        state.last ? \" (last)\" : \"\"));\n        state.mode = STORED;\n        break;\n      case 1:                             /* fixed block */\n        fixedtables(state);\n        //Tracev((stderr, \"inflate:     fixed codes block%s\\n\",\n        //        state.last ? \" (last)\" : \"\"));\n        state.mode = LEN_;             /* decode codes */\n        if (flush === Z_TREES) {\n          //--- DROPBITS(2) ---//\n          hold >>>= 2;\n          bits -= 2;\n          //---//\n          break inf_leave;\n        }\n        break;\n      case 2:                             /* dynamic block */\n        //Tracev((stderr, \"inflate:     dynamic codes block%s\\n\",\n        //        state.last ? \" (last)\" : \"\"));\n        state.mode = TABLE;\n        break;\n      case 3:\n        strm.msg = 'invalid block type';\n        state.mode = BAD;\n      }\n      //--- DROPBITS(2) ---//\n      hold >>>= 2;\n      bits -= 2;\n      //---//\n      break;\n    case STORED:\n      //--- BYTEBITS() ---// /* go to byte boundary */\n      hold >>>= bits & 7;\n      bits -= bits & 7;\n      //---//\n      //=== NEEDBITS(32); */\n      while (bits < 32) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      if ((hold & 0xffff) !== ((hold >>> 16) ^ 0xffff)) {\n        strm.msg = 'invalid stored block lengths';\n        state.mode = BAD;\n        break;\n      }\n      state.length = hold & 0xffff;\n      //Tracev((stderr, \"inflate:       stored length %u\\n\",\n      //        state.length));\n      //=== INITBITS();\n      hold = 0;\n      bits = 0;\n      //===//\n      state.mode = COPY_;\n      if (flush === Z_TREES) { break inf_leave; }\n      /* falls through */\n    case COPY_:\n      state.mode = COPY;\n      /* falls through */\n    case COPY:\n      copy = state.length;\n      if (copy) {\n        if (copy > have) { copy = have; }\n        if (copy > left) { copy = left; }\n        if (copy === 0) { break inf_leave; }\n        //--- zmemcpy(put, next, copy); ---\n        utils.arraySet(output, input, next, copy, put);\n        //---//\n        have -= copy;\n        next += copy;\n        left -= copy;\n        put += copy;\n        state.length -= copy;\n        break;\n      }\n      //Tracev((stderr, \"inflate:       stored end\\n\"));\n      state.mode = TYPE;\n      break;\n    case TABLE:\n      //=== NEEDBITS(14); */\n      while (bits < 14) {\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n      }\n      //===//\n      state.nlen = (hold & 0x1f)/*BITS(5)*/ + 257;\n      //--- DROPBITS(5) ---//\n      hold >>>= 5;\n      bits -= 5;\n      //---//\n      state.ndist = (hold & 0x1f)/*BITS(5)*/ + 1;\n      //--- DROPBITS(5) ---//\n      hold >>>= 5;\n      bits -= 5;\n      //---//\n      state.ncode = (hold & 0x0f)/*BITS(4)*/ + 4;\n      //--- DROPBITS(4) ---//\n      hold >>>= 4;\n      bits -= 4;\n      //---//\n//#ifndef PKZIP_BUG_WORKAROUND\n      if (state.nlen > 286 || state.ndist > 30) {\n        strm.msg = 'too many length or distance symbols';\n        state.mode = BAD;\n        break;\n      }\n//#endif\n      //Tracev((stderr, \"inflate:       table sizes ok\\n\"));\n      state.have = 0;\n      state.mode = LENLENS;\n      /* falls through */\n    case LENLENS:\n      while (state.have < state.ncode) {\n        //=== NEEDBITS(3);\n        while (bits < 3) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        state.lens[order[state.have++]] = (hold & 0x07);//BITS(3);\n        //--- DROPBITS(3) ---//\n        hold >>>= 3;\n        bits -= 3;\n        //---//\n      }\n      while (state.have < 19) {\n        state.lens[order[state.have++]] = 0;\n      }\n      // We have separate tables & no pointers. 2 commented lines below not needed.\n      //state.next = state.codes;\n      //state.lencode = state.next;\n      // Switch to use dynamic table\n      state.lencode = state.lendyn;\n      state.lenbits = 7;\n\n      opts = {bits: state.lenbits};\n      ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);\n      state.lenbits = opts.bits;\n\n      if (ret) {\n        strm.msg = 'invalid code lengths set';\n        state.mode = BAD;\n        break;\n      }\n      //Tracev((stderr, \"inflate:       code lengths ok\\n\"));\n      state.have = 0;\n      state.mode = CODELENS;\n      /* falls through */\n    case CODELENS:\n      while (state.have < state.nlen + state.ndist) {\n        for (;;) {\n          here = state.lencode[hold & ((1 << state.lenbits) - 1)];/*BITS(state.lenbits)*/\n          here_bits = here >>> 24;\n          here_op = (here >>> 16) & 0xff;\n          here_val = here & 0xffff;\n\n          if ((here_bits) <= bits) { break; }\n          //--- PULLBYTE() ---//\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n          //---//\n        }\n        if (here_val < 16) {\n          //--- DROPBITS(here.bits) ---//\n          hold >>>= here_bits;\n          bits -= here_bits;\n          //---//\n          state.lens[state.have++] = here_val;\n        }\n        else {\n          if (here_val === 16) {\n            //=== NEEDBITS(here.bits + 2);\n            n = here_bits + 2;\n            while (bits < n) {\n              if (have === 0) { break inf_leave; }\n              have--;\n              hold += input[next++] << bits;\n              bits += 8;\n            }\n            //===//\n            //--- DROPBITS(here.bits) ---//\n            hold >>>= here_bits;\n            bits -= here_bits;\n            //---//\n            if (state.have === 0) {\n              strm.msg = 'invalid bit length repeat';\n              state.mode = BAD;\n              break;\n            }\n            len = state.lens[state.have - 1];\n            copy = 3 + (hold & 0x03);//BITS(2);\n            //--- DROPBITS(2) ---//\n            hold >>>= 2;\n            bits -= 2;\n            //---//\n          }\n          else if (here_val === 17) {\n            //=== NEEDBITS(here.bits + 3);\n            n = here_bits + 3;\n            while (bits < n) {\n              if (have === 0) { break inf_leave; }\n              have--;\n              hold += input[next++] << bits;\n              bits += 8;\n            }\n            //===//\n            //--- DROPBITS(here.bits) ---//\n            hold >>>= here_bits;\n            bits -= here_bits;\n            //---//\n            len = 0;\n            copy = 3 + (hold & 0x07);//BITS(3);\n            //--- DROPBITS(3) ---//\n            hold >>>= 3;\n            bits -= 3;\n            //---//\n          }\n          else {\n            //=== NEEDBITS(here.bits + 7);\n            n = here_bits + 7;\n            while (bits < n) {\n              if (have === 0) { break inf_leave; }\n              have--;\n              hold += input[next++] << bits;\n              bits += 8;\n            }\n            //===//\n            //--- DROPBITS(here.bits) ---//\n            hold >>>= here_bits;\n            bits -= here_bits;\n            //---//\n            len = 0;\n            copy = 11 + (hold & 0x7f);//BITS(7);\n            //--- DROPBITS(7) ---//\n            hold >>>= 7;\n            bits -= 7;\n            //---//\n          }\n          if (state.have + copy > state.nlen + state.ndist) {\n            strm.msg = 'invalid bit length repeat';\n            state.mode = BAD;\n            break;\n          }\n          while (copy--) {\n            state.lens[state.have++] = len;\n          }\n        }\n      }\n\n      /* handle error breaks in while */\n      if (state.mode === BAD) { break; }\n\n      /* check for end-of-block code (better have one) */\n      if (state.lens[256] === 0) {\n        strm.msg = 'invalid code -- missing end-of-block';\n        state.mode = BAD;\n        break;\n      }\n\n      /* build code tables -- note: do not change the lenbits or distbits\n         values here (9 and 6) without reading the comments in inftrees.h\n         concerning the ENOUGH constants, which depend on those values */\n      state.lenbits = 9;\n\n      opts = {bits: state.lenbits};\n      ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);\n      // We have separate tables & no pointers. 2 commented lines below not needed.\n      // state.next_index = opts.table_index;\n      state.lenbits = opts.bits;\n      // state.lencode = state.next;\n\n      if (ret) {\n        strm.msg = 'invalid literal/lengths set';\n        state.mode = BAD;\n        break;\n      }\n\n      state.distbits = 6;\n      //state.distcode.copy(state.codes);\n      // Switch to use dynamic table\n      state.distcode = state.distdyn;\n      opts = {bits: state.distbits};\n      ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);\n      // We have separate tables & no pointers. 2 commented lines below not needed.\n      // state.next_index = opts.table_index;\n      state.distbits = opts.bits;\n      // state.distcode = state.next;\n\n      if (ret) {\n        strm.msg = 'invalid distances set';\n        state.mode = BAD;\n        break;\n      }\n      //Tracev((stderr, 'inflate:       codes ok\\n'));\n      state.mode = LEN_;\n      if (flush === Z_TREES) { break inf_leave; }\n      /* falls through */\n    case LEN_:\n      state.mode = LEN;\n      /* falls through */\n    case LEN:\n      if (have >= 6 && left >= 258) {\n        //--- RESTORE() ---\n        strm.next_out = put;\n        strm.avail_out = left;\n        strm.next_in = next;\n        strm.avail_in = have;\n        state.hold = hold;\n        state.bits = bits;\n        //---\n        inflate_fast(strm, _out);\n        //--- LOAD() ---\n        put = strm.next_out;\n        output = strm.output;\n        left = strm.avail_out;\n        next = strm.next_in;\n        input = strm.input;\n        have = strm.avail_in;\n        hold = state.hold;\n        bits = state.bits;\n        //---\n\n        if (state.mode === TYPE) {\n          state.back = -1;\n        }\n        break;\n      }\n      state.back = 0;\n      for (;;) {\n        here = state.lencode[hold & ((1 << state.lenbits) -1)];  /*BITS(state.lenbits)*/\n        here_bits = here >>> 24;\n        here_op = (here >>> 16) & 0xff;\n        here_val = here & 0xffff;\n\n        if (here_bits <= bits) { break; }\n        //--- PULLBYTE() ---//\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n        //---//\n      }\n      if (here_op && (here_op & 0xf0) === 0) {\n        last_bits = here_bits;\n        last_op = here_op;\n        last_val = here_val;\n        for (;;) {\n          here = state.lencode[last_val +\n                  ((hold & ((1 << (last_bits + last_op)) -1))/*BITS(last.bits + last.op)*/ >> last_bits)];\n          here_bits = here >>> 24;\n          here_op = (here >>> 16) & 0xff;\n          here_val = here & 0xffff;\n\n          if ((last_bits + here_bits) <= bits) { break; }\n          //--- PULLBYTE() ---//\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n          //---//\n        }\n        //--- DROPBITS(last.bits) ---//\n        hold >>>= last_bits;\n        bits -= last_bits;\n        //---//\n        state.back += last_bits;\n      }\n      //--- DROPBITS(here.bits) ---//\n      hold >>>= here_bits;\n      bits -= here_bits;\n      //---//\n      state.back += here_bits;\n      state.length = here_val;\n      if (here_op === 0) {\n        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?\n        //        \"inflate:         literal '%c'\\n\" :\n        //        \"inflate:         literal 0x%02x\\n\", here.val));\n        state.mode = LIT;\n        break;\n      }\n      if (here_op & 32) {\n        //Tracevv((stderr, \"inflate:         end of block\\n\"));\n        state.back = -1;\n        state.mode = TYPE;\n        break;\n      }\n      if (here_op & 64) {\n        strm.msg = 'invalid literal/length code';\n        state.mode = BAD;\n        break;\n      }\n      state.extra = here_op & 15;\n      state.mode = LENEXT;\n      /* falls through */\n    case LENEXT:\n      if (state.extra) {\n        //=== NEEDBITS(state.extra);\n        n = state.extra;\n        while (bits < n) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        state.length += hold & ((1 << state.extra) -1)/*BITS(state.extra)*/;\n        //--- DROPBITS(state.extra) ---//\n        hold >>>= state.extra;\n        bits -= state.extra;\n        //---//\n        state.back += state.extra;\n      }\n      //Tracevv((stderr, \"inflate:         length %u\\n\", state.length));\n      state.was = state.length;\n      state.mode = DIST;\n      /* falls through */\n    case DIST:\n      for (;;) {\n        here = state.distcode[hold & ((1 << state.distbits) -1)];/*BITS(state.distbits)*/\n        here_bits = here >>> 24;\n        here_op = (here >>> 16) & 0xff;\n        here_val = here & 0xffff;\n\n        if ((here_bits) <= bits) { break; }\n        //--- PULLBYTE() ---//\n        if (have === 0) { break inf_leave; }\n        have--;\n        hold += input[next++] << bits;\n        bits += 8;\n        //---//\n      }\n      if ((here_op & 0xf0) === 0) {\n        last_bits = here_bits;\n        last_op = here_op;\n        last_val = here_val;\n        for (;;) {\n          here = state.distcode[last_val +\n                  ((hold & ((1 << (last_bits + last_op)) -1))/*BITS(last.bits + last.op)*/ >> last_bits)];\n          here_bits = here >>> 24;\n          here_op = (here >>> 16) & 0xff;\n          here_val = here & 0xffff;\n\n          if ((last_bits + here_bits) <= bits) { break; }\n          //--- PULLBYTE() ---//\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n          //---//\n        }\n        //--- DROPBITS(last.bits) ---//\n        hold >>>= last_bits;\n        bits -= last_bits;\n        //---//\n        state.back += last_bits;\n      }\n      //--- DROPBITS(here.bits) ---//\n      hold >>>= here_bits;\n      bits -= here_bits;\n      //---//\n      state.back += here_bits;\n      if (here_op & 64) {\n        strm.msg = 'invalid distance code';\n        state.mode = BAD;\n        break;\n      }\n      state.offset = here_val;\n      state.extra = (here_op) & 15;\n      state.mode = DISTEXT;\n      /* falls through */\n    case DISTEXT:\n      if (state.extra) {\n        //=== NEEDBITS(state.extra);\n        n = state.extra;\n        while (bits < n) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        state.offset += hold & ((1 << state.extra) -1)/*BITS(state.extra)*/;\n        //--- DROPBITS(state.extra) ---//\n        hold >>>= state.extra;\n        bits -= state.extra;\n        //---//\n        state.back += state.extra;\n      }\n//#ifdef INFLATE_STRICT\n      if (state.offset > state.dmax) {\n        strm.msg = 'invalid distance too far back';\n        state.mode = BAD;\n        break;\n      }\n//#endif\n      //Tracevv((stderr, \"inflate:         distance %u\\n\", state.offset));\n      state.mode = MATCH;\n      /* falls through */\n    case MATCH:\n      if (left === 0) { break inf_leave; }\n      copy = _out - left;\n      if (state.offset > copy) {         /* copy from window */\n        copy = state.offset - copy;\n        if (copy > state.whave) {\n          if (state.sane) {\n            strm.msg = 'invalid distance too far back';\n            state.mode = BAD;\n            break;\n          }\n// (!) This block is disabled in zlib defailts,\n// don't enable it for binary compatibility\n//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR\n//          Trace((stderr, \"inflate.c too far\\n\"));\n//          copy -= state.whave;\n//          if (copy > state.length) { copy = state.length; }\n//          if (copy > left) { copy = left; }\n//          left -= copy;\n//          state.length -= copy;\n//          do {\n//            output[put++] = 0;\n//          } while (--copy);\n//          if (state.length === 0) { state.mode = LEN; }\n//          break;\n//#endif\n        }\n        if (copy > state.wnext) {\n          copy -= state.wnext;\n          from = state.wsize - copy;\n        }\n        else {\n          from = state.wnext - copy;\n        }\n        if (copy > state.length) { copy = state.length; }\n        from_source = state.window;\n      }\n      else {                              /* copy from output */\n        from_source = output;\n        from = put - state.offset;\n        copy = state.length;\n      }\n      if (copy > left) { copy = left; }\n      left -= copy;\n      state.length -= copy;\n      do {\n        output[put++] = from_source[from++];\n      } while (--copy);\n      if (state.length === 0) { state.mode = LEN; }\n      break;\n    case LIT:\n      if (left === 0) { break inf_leave; }\n      output[put++] = state.length;\n      left--;\n      state.mode = LEN;\n      break;\n    case CHECK:\n      if (state.wrap) {\n        //=== NEEDBITS(32);\n        while (bits < 32) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          // Use '|' insdead of '+' to make sure that result is signed\n          hold |= input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        _out -= left;\n        strm.total_out += _out;\n        state.total += _out;\n        if (_out) {\n          strm.adler = state.check =\n              /*UPDATE(state.check, put - _out, _out);*/\n              (state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out));\n\n        }\n        _out = left;\n        // NB: crc32 stored as signed 32-bit int, ZSWAP32 returns signed too\n        if ((state.flags ? hold : ZSWAP32(hold)) !== state.check) {\n          strm.msg = 'incorrect data check';\n          state.mode = BAD;\n          break;\n        }\n        //=== INITBITS();\n        hold = 0;\n        bits = 0;\n        //===//\n        //Tracev((stderr, \"inflate:   check matches trailer\\n\"));\n      }\n      state.mode = LENGTH;\n      /* falls through */\n    case LENGTH:\n      if (state.wrap && state.flags) {\n        //=== NEEDBITS(32);\n        while (bits < 32) {\n          if (have === 0) { break inf_leave; }\n          have--;\n          hold += input[next++] << bits;\n          bits += 8;\n        }\n        //===//\n        if (hold !== (state.total & 0xffffffff)) {\n          strm.msg = 'incorrect length check';\n          state.mode = BAD;\n          break;\n        }\n        //=== INITBITS();\n        hold = 0;\n        bits = 0;\n        //===//\n        //Tracev((stderr, \"inflate:   length matches trailer\\n\"));\n      }\n      state.mode = DONE;\n      /* falls through */\n    case DONE:\n      ret = Z_STREAM_END;\n      break inf_leave;\n    case BAD:\n      ret = Z_DATA_ERROR;\n      break inf_leave;\n    case MEM:\n      return Z_MEM_ERROR;\n    case SYNC:\n      /* falls through */\n    default:\n      return Z_STREAM_ERROR;\n    }\n  }\n\n  // inf_leave <- here is real place for \"goto inf_leave\", emulated via \"break inf_leave\"\n\n  /*\n     Return from inflate(), updating the total counts and the check value.\n     If there was no progress during the inflate() call, return a buffer\n     error.  Call updatewindow() to create and/or update the window state.\n     Note: a memory error from inflate() is non-recoverable.\n   */\n\n  //--- RESTORE() ---\n  strm.next_out = put;\n  strm.avail_out = left;\n  strm.next_in = next;\n  strm.avail_in = have;\n  state.hold = hold;\n  state.bits = bits;\n  //---\n\n  if (state.wsize || (_out !== strm.avail_out && state.mode < BAD &&\n                      (state.mode < CHECK || flush !== Z_FINISH))) {\n    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {\n      state.mode = MEM;\n      return Z_MEM_ERROR;\n    }\n  }\n  _in -= strm.avail_in;\n  _out -= strm.avail_out;\n  strm.total_in += _in;\n  strm.total_out += _out;\n  state.total += _out;\n  if (state.wrap && _out) {\n    strm.adler = state.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/\n      (state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out));\n  }\n  strm.data_type = state.bits + (state.last ? 64 : 0) +\n                    (state.mode === TYPE ? 128 : 0) +\n                    (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);\n  if (((_in === 0 && _out === 0) || flush === Z_FINISH) && ret === Z_OK) {\n    ret = Z_BUF_ERROR;\n  }\n  return ret;\n}\n\nfunction inflateEnd(strm) {\n\n  if (!strm || !strm.state /*|| strm->zfree == (free_func)0*/) {\n    return Z_STREAM_ERROR;\n  }\n\n  var state = strm.state;\n  if (state.window) {\n    state.window = null;\n  }\n  strm.state = null;\n  return Z_OK;\n}\n\nfunction inflateGetHeader(strm, head) {\n  var state;\n\n  /* check state */\n  if (!strm || !strm.state) { return Z_STREAM_ERROR; }\n  state = strm.state;\n  if ((state.wrap & 2) === 0) { return Z_STREAM_ERROR; }\n\n  /* save header structure */\n  state.head = head;\n  head.done = false;\n  return Z_OK;\n}\n\n\nexports.inflateReset = inflateReset;\nexports.inflateReset2 = inflateReset2;\nexports.inflateResetKeep = inflateResetKeep;\nexports.inflateInit = inflateInit;\nexports.inflateInit2 = inflateInit2;\nexports.inflate = inflate;\nexports.inflateEnd = inflateEnd;\nexports.inflateGetHeader = inflateGetHeader;\nexports.inflateInfo = 'pako inflate (from Nodeca project)';\n\n/* Not implemented\nexports.inflateCopy = inflateCopy;\nexports.inflateGetDictionary = inflateGetDictionary;\nexports.inflateMark = inflateMark;\nexports.inflatePrime = inflatePrime;\nexports.inflateSetDictionary = inflateSetDictionary;\nexports.inflateSync = inflateSync;\nexports.inflateSyncPoint = inflateSyncPoint;\nexports.inflateUndermine = inflateUndermine;\n*/\n},{\"../utils/common\":7,\"./adler32\":9,\"./crc32\":11,\"./inffast\":13,\"./inftrees\":15}],15:[function(require,module,exports){\n'use strict';\n\n\nvar utils = require('../utils/common');\n\nvar MAXBITS = 15;\nvar ENOUGH_LENS = 852;\nvar ENOUGH_DISTS = 592;\n//var ENOUGH = (ENOUGH_LENS+ENOUGH_DISTS);\n\nvar CODES = 0;\nvar LENS = 1;\nvar DISTS = 2;\n\nvar lbase = [ /* Length codes 257..285 base */\n  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,\n  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0\n];\n\nvar lext = [ /* Length codes 257..285 extra */\n  16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,\n  19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78\n];\n\nvar dbase = [ /* Distance codes 0..29 base */\n  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,\n  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,\n  8193, 12289, 16385, 24577, 0, 0\n];\n\nvar dext = [ /* Distance codes 0..29 extra */\n  16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,\n  23, 23, 24, 24, 25, 25, 26, 26, 27, 27,\n  28, 28, 29, 29, 64, 64\n];\n\nmodule.exports = function inflate_table(type, lens, lens_index, codes, table, table_index, work, opts)\n{\n  var bits = opts.bits;\n      //here = opts.here; /* table entry for duplication */\n\n  var len = 0;               /* a code's length in bits */\n  var sym = 0;               /* index of code symbols */\n  var min = 0, max = 0;          /* minimum and maximum code lengths */\n  var root = 0;              /* number of index bits for root table */\n  var curr = 0;              /* number of index bits for current table */\n  var drop = 0;              /* code bits to drop for sub-table */\n  var left = 0;                   /* number of prefix codes available */\n  var used = 0;              /* code entries in table used */\n  var huff = 0;              /* Huffman code */\n  var incr;              /* for incrementing code, index */\n  var fill;              /* index for replicating entries */\n  var low;               /* low bits for current root entry */\n  var mask;              /* mask for low root bits */\n  var next;             /* next available space in table */\n  var base = null;     /* base value table to use */\n  var base_index = 0;\n//  var shoextra;    /* extra bits table to use */\n  var end;                    /* use base and extra for symbol > end */\n  var count = new utils.Buf16(MAXBITS+1); //[MAXBITS+1];    /* number of codes of each length */\n  var offs = new utils.Buf16(MAXBITS+1); //[MAXBITS+1];     /* offsets in table for each length */\n  var extra = null;\n  var extra_index = 0;\n\n  var here_bits, here_op, here_val;\n\n  /*\n   Process a set of code lengths to create a canonical Huffman code.  The\n   code lengths are lens[0..codes-1].  Each length corresponds to the\n   symbols 0..codes-1.  The Huffman code is generated by first sorting the\n   symbols by length from short to long, and retaining the symbol order\n   for codes with equal lengths.  Then the code starts with all zero bits\n   for the first code of the shortest length, and the codes are integer\n   increments for the same length, and zeros are appended as the length\n   increases.  For the deflate format, these bits are stored backwards\n   from their more natural integer increment ordering, and so when the\n   decoding tables are built in the large loop below, the integer codes\n   are incremented backwards.\n\n   This routine assumes, but does not check, that all of the entries in\n   lens[] are in the range 0..MAXBITS.  The caller must assure this.\n   1..MAXBITS is interpreted as that code length.  zero means that that\n   symbol does not occur in this code.\n\n   The codes are sorted by computing a count of codes for each length,\n   creating from that a table of starting indices for each length in the\n   sorted table, and then entering the symbols in order in the sorted\n   table.  The sorted table is work[], with that space being provided by\n   the caller.\n\n   The length counts are used for other purposes as well, i.e. finding\n   the minimum and maximum length codes, determining if there are any\n   codes at all, checking for a valid set of lengths, and looking ahead\n   at length counts to determine sub-table sizes when building the\n   decoding tables.\n   */\n\n  /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */\n  for (len = 0; len <= MAXBITS; len++) {\n    count[len] = 0;\n  }\n  for (sym = 0; sym < codes; sym++) {\n    count[lens[lens_index + sym]]++;\n  }\n\n  /* bound code lengths, force root to be within code lengths */\n  root = bits;\n  for (max = MAXBITS; max >= 1; max--) {\n    if (count[max] !== 0) { break; }\n  }\n  if (root > max) {\n    root = max;\n  }\n  if (max === 0) {                     /* no symbols to code at all */\n    //table.op[opts.table_index] = 64;  //here.op = (var char)64;    /* invalid code marker */\n    //table.bits[opts.table_index] = 1;   //here.bits = (var char)1;\n    //table.val[opts.table_index++] = 0;   //here.val = (var short)0;\n    table[table_index++] = (1 << 24) | (64 << 16) | 0;\n\n\n    //table.op[opts.table_index] = 64;\n    //table.bits[opts.table_index] = 1;\n    //table.val[opts.table_index++] = 0;\n    table[table_index++] = (1 << 24) | (64 << 16) | 0;\n\n    opts.bits = 1;\n    return 0;     /* no symbols, but wait for decoding to report error */\n  }\n  for (min = 1; min < max; min++) {\n    if (count[min] !== 0) { break; }\n  }\n  if (root < min) {\n    root = min;\n  }\n\n  /* check for an over-subscribed or incomplete set of lengths */\n  left = 1;\n  for (len = 1; len <= MAXBITS; len++) {\n    left <<= 1;\n    left -= count[len];\n    if (left < 0) {\n      return -1;\n    }        /* over-subscribed */\n  }\n  if (left > 0 && (type === CODES || max !== 1)) {\n    return -1;                      /* incomplete set */\n  }\n\n  /* generate offsets into symbol table for each length for sorting */\n  offs[1] = 0;\n  for (len = 1; len < MAXBITS; len++) {\n    offs[len + 1] = offs[len] + count[len];\n  }\n\n  /* sort symbols by length, by symbol order within each length */\n  for (sym = 0; sym < codes; sym++) {\n    if (lens[lens_index + sym] !== 0) {\n      work[offs[lens[lens_index + sym]]++] = sym;\n    }\n  }\n\n  /*\n   Create and fill in decoding tables.  In this loop, the table being\n   filled is at next and has curr index bits.  The code being used is huff\n   with length len.  That code is converted to an index by dropping drop\n   bits off of the bottom.  For codes where len is less than drop + curr,\n   those top drop + curr - len bits are incremented through all values to\n   fill the table with replicated entries.\n\n   root is the number of index bits for the root table.  When len exceeds\n   root, sub-tables are created pointed to by the root entry with an index\n   of the low root bits of huff.  This is saved in low to check for when a\n   new sub-table should be started.  drop is zero when the root table is\n   being filled, and drop is root when sub-tables are being filled.\n\n   When a new sub-table is needed, it is necessary to look ahead in the\n   code lengths to determine what size sub-table is needed.  The length\n   counts are used for this, and so count[] is decremented as codes are\n   entered in the tables.\n\n   used keeps track of how many table entries have been allocated from the\n   provided *table space.  It is checked for LENS and DIST tables against\n   the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in\n   the initial root table size constants.  See the comments in inftrees.h\n   for more information.\n\n   sym increments through all symbols, and the loop terminates when\n   all codes of length max, i.e. all codes, have been processed.  This\n   routine permits incomplete codes, so another loop after this one fills\n   in the rest of the decoding tables with invalid code markers.\n   */\n\n  /* set up for code type */\n  // poor man optimization - use if-else instead of switch,\n  // to avoid deopts in old v8\n  if (type === CODES) {\n      base = extra = work;    /* dummy value--not used */\n      end = 19;\n  } else if (type === LENS) {\n      base = lbase;\n      base_index -= 257;\n      extra = lext;\n      extra_index -= 257;\n      end = 256;\n  } else {                    /* DISTS */\n      base = dbase;\n      extra = dext;\n      end = -1;\n  }\n\n  /* initialize opts for loop */\n  huff = 0;                   /* starting code */\n  sym = 0;                    /* starting code symbol */\n  len = min;                  /* starting code length */\n  next = table_index;              /* current table to fill in */\n  curr = root;                /* current table index bits */\n  drop = 0;                   /* current bits to drop from code for index */\n  low = -1;                   /* trigger new sub-table when len > root */\n  used = 1 << root;          /* use root table entries */\n  mask = used - 1;            /* mask for comparing low */\n\n  /* check available table space */\n  if ((type === LENS && used > ENOUGH_LENS) ||\n    (type === DISTS && used > ENOUGH_DISTS)) {\n    return 1;\n  }\n\n  var i=0;\n  /* process all codes and make table entries */\n  for (;;) {\n    i++;\n    /* create table entry */\n    here_bits = len - drop;\n    if (work[sym] < end) {\n      here_op = 0;\n      here_val = work[sym];\n    }\n    else if (work[sym] > end) {\n      here_op = extra[extra_index + work[sym]];\n      here_val = base[base_index + work[sym]];\n    }\n    else {\n      here_op = 32 + 64;         /* end of block */\n      here_val = 0;\n    }\n\n    /* replicate for those indices with low len bits equal to huff */\n    incr = 1 << (len - drop);\n    fill = 1 << curr;\n    min = fill;                 /* save offset to next table */\n    do {\n      fill -= incr;\n      table[next + (huff >> drop) + fill] = (here_bits << 24) | (here_op << 16) | here_val |0;\n    } while (fill !== 0);\n\n    /* backwards increment the len-bit code huff */\n    incr = 1 << (len - 1);\n    while (huff & incr) {\n      incr >>= 1;\n    }\n    if (incr !== 0) {\n      huff &= incr - 1;\n      huff += incr;\n    } else {\n      huff = 0;\n    }\n\n    /* go to next symbol, update count, len */\n    sym++;\n    if (--count[len] === 0) {\n      if (len === max) { break; }\n      len = lens[lens_index + work[sym]];\n    }\n\n    /* create new sub-table if needed */\n    if (len > root && (huff & mask) !== low) {\n      /* if first time, transition to sub-tables */\n      if (drop === 0) {\n        drop = root;\n      }\n\n      /* increment past last table */\n      next += min;            /* here min is 1 << curr */\n\n      /* determine length of next table */\n      curr = len - drop;\n      left = 1 << curr;\n      while (curr + drop < max) {\n        left -= count[curr + drop];\n        if (left <= 0) { break; }\n        curr++;\n        left <<= 1;\n      }\n\n      /* check for enough space */\n      used += 1 << curr;\n      if ((type === LENS && used > ENOUGH_LENS) ||\n        (type === DISTS && used > ENOUGH_DISTS)) {\n        return 1;\n      }\n\n      /* point entry in root table to sub-table */\n      low = huff & mask;\n      /*table.op[low] = curr;\n      table.bits[low] = root;\n      table.val[low] = next - opts.table_index;*/\n      table[low] = (root << 24) | (curr << 16) | (next - table_index) |0;\n    }\n  }\n\n  /* fill in remaining table entry if code is incomplete (guaranteed to have\n   at most one remaining entry, since if the code is incomplete, the\n   maximum code length that was allowed to get this far is one bit) */\n  if (huff !== 0) {\n    //table.op[next + huff] = 64;            /* invalid code marker */\n    //table.bits[next + huff] = len - drop;\n    //table.val[next + huff] = 0;\n    table[next + huff] = ((len - drop) << 24) | (64 << 16) |0;\n  }\n\n  /* set return parameters */\n  //opts.table_index += used;\n  opts.bits = root;\n  return 0;\n};\n\n},{\"../utils/common\":7}],16:[function(require,module,exports){\n'use strict';\n\nmodule.exports = {\n  '2':    'need dictionary',     /* Z_NEED_DICT       2  */\n  '1':    'stream end',          /* Z_STREAM_END      1  */\n  '0':    '',                    /* Z_OK              0  */\n  '-1':   'file error',          /* Z_ERRNO         (-1) */\n  '-2':   'stream error',        /* Z_STREAM_ERROR  (-2) */\n  '-3':   'data error',          /* Z_DATA_ERROR    (-3) */\n  '-4':   'insufficient memory', /* Z_MEM_ERROR     (-4) */\n  '-5':   'buffer error',        /* Z_BUF_ERROR     (-5) */\n  '-6':   'incompatible version' /* Z_VERSION_ERROR (-6) */\n};\n},{}],17:[function(require,module,exports){\n'use strict';\n\n\nfunction ZStream() {\n  /* next input byte */\n  this.input = null; // JS specific, because we have no pointers\n  this.next_in = 0;\n  /* number of bytes available at input */\n  this.avail_in = 0;\n  /* total number of input bytes read so far */\n  this.total_in = 0;\n  /* next output byte should be put there */\n  this.output = null; // JS specific, because we have no pointers\n  this.next_out = 0;\n  /* remaining free space at output */\n  this.avail_out = 0;\n  /* total number of bytes output so far */\n  this.total_out = 0;\n  /* last error message, NULL if no error */\n  this.msg = ''/*Z_NULL*/;\n  /* not visible by applications */\n  this.state = null;\n  /* best guess about the data type: binary or text */\n  this.data_type = 2/*Z_UNKNOWN*/;\n  /* adler32 value of the uncompressed data */\n  this.adler = 0;\n}\n\nmodule.exports = ZStream;\n},{}],18:[function(require,module,exports){\n(function (Buffer){\n// Generated by CoffeeScript 1.8.0\n(function() {\n  var CR, Control, Extend, L, LF, LV, LVT, Regional_Indicator, SpacingMark, T, UnicodeTrie, V, classTrie, codePointAt, fs, shouldBreak, _ref;\n\n  _ref = require('./classes.json'), CR = _ref.CR, LF = _ref.LF, Control = _ref.Control, Extend = _ref.Extend, Regional_Indicator = _ref.Regional_Indicator, SpacingMark = _ref.SpacingMark, L = _ref.L, V = _ref.V, T = _ref.T, LV = _ref.LV, LVT = _ref.LVT;\n\n  UnicodeTrie = require('unicode-trie');\n\n  \n\n  classTrie = new UnicodeTrie(Buffer(\"AA4QAAAAAAAAAAez3ZR7UNKJFsdv7Va7mtHLMg3Ynq5SoeV2faBUm6RpmatrPlH7pVa+Vk0NEVm1jQyLNtdXKFRoqauiZZmPpJKgfAD2AFdUUhJUMBJUCoXfet25f9yZe+f2956/zpzvmTmf+Z4zZ6Jv09Vhfxg3IdF5j/OUchDaiF/8wpdMPrj5V7et1yr3up3cujrn4N03S3MOYuZLtX3f/PpwNtHkfrxk66ZFB1brtEzd2kUHMpDIF52M09qbvlWMzO1po+3t//g+14bzpU+XDYmypMA//LLJg94nn3yt8733m373sGK+KfAUI3vX/+z0dLGuuLV0fbKd4Px8dRQ19+aSSNgbRoaWIGPWmPp6Z5MdzU/d+mWv4+gtkgtquQ17tBPPKeJ+fbsofAXceEf9U3OLGK04LQ3sj2N1t9/VuFFhYEzqLyPjQ7jLh7R1wfL6eQKObkK/u3nU2XAfEulFVEPW+cN7Cetug2bEgWj1c2jYxZ6bJgDMkjTi9ziB3kcIc9bm6mnwQQ0ueGNBIUeHKBAtEDFVqnwIJZ+JbrzZEX3/ZxElePD3Q63w43gWSHIZNSf0hIm7ETGhPNFdHSsWTkFA6bX1pbQrTRcX4l0wXVVLm9Qnr5S2KK8mY2RRtHMmAJa6EUtX27eXiOQo3SxfCa5IOUd8ITVStGtMKEHKo++cIoSAk5O95HD57n87ddA49qzAFUI4ZxZ2cRWnKOzSBtmH+serEdX1T9Y52bOuUoyqKp64Qk3seg5YQM/2fA+HLTU7cd52e9GJCw7pO+rYRtExdc9W8JjvGFnWZ37yPvTFkQYBZlnIlIBEWnTBLDz3P8ytz9akqj9zmcs+Vdy4ZB78umffmp0NPfvXO08Nhf+8CWMGZFlFFrVzF3tU13GWBinfzuWl+x5zNdk1fupGzrq+0RtkmO6DzeOVW3Jtn6zd0zUEZG7z8weyd6b8ZP25iMjPRbz8mZMzLOH/7fq+Ajxtni1P+ugflmP615kS8/6P3f1Aa0h43lstuWHKJQqh0K9vihpJbBYz6/Rn3DDot7raDYq0DRRnPJ/Vhn8mzihuEhhjJy9EybYjzz2zoBUjWt+axp+TDeqzjrcOFePHFsT3sQtik+hf4scn/VpIuhz7QZLoKRmu0bb3yuAcdaqsBZ3hftVy82YtafapNv4Pvs/uQ6F/4XHmIh5rwj8RcGypWZ6eMQmNCzTgWvZgqQs7Wiw0vhv56Ai7OWhQvEHl1FAe03DnWraqUF6lAldcf6UiMfRg/Mu2yH3gA6M+OTBz+kRRoKPXUGQruvBAy7v+BK/cqGSFHtM1yXS7rvRBnGT1pT5kuftCgBM7lwHS83s9hzgxHk7LYnkt76FTPURYCQjYFrA2dB7t4rNvdtS+BquiQ7iNrYbkwar5P3K4/IfSUHqZYD4dNy9PwJT/sK2mWr5PzqN2cetG8EwPcBe1gU+eaxSjeBL0U4dA9iVHGcRSWN+4qiEO1tFPqR4Xape/iT3MHZF3NCOzOHVBwux8InlvmZ6FCABBz1VEkOUX0UMU1SKX4nfUhf5TvFFoQL2unwiXBgrargMHipJctow1nz1akDyLzPdb0m08zIMPp9e65ZcNNM65rLLDSqKLgbTKtQSJUQulWAEv9LB0oZYRAkpFM4b+pGLgcO8kumDAUqZzvztcSx2ZZGkVoL+3iChopi+miRWROHQzBn92jiHfFFrNL0tovddmQA9/jOd9XetsWD9mIHaBbhGw2RtJIHm62RnL7r4ovkJJ1EMRZzJiWfFo9BumPNjDnBjvI9OLaNliLnpU92qSRXGc1iv8pMymOJoqM1zilaUTBEtgQfwx7sNYp+nG35Ie4Lsnyn9MmGH5OjIHcBKtT74rfiL6m2/B69KJSo2dZ4mKVigLednWwK5E0aUJFMYA6C6zKfTrZ8WGMKAiM2oWR+CjoAUF0INO50oDJBbqa/QfI0qJ1fbANYd1rt0mUoNLwUwvLZKFmXYXKFKWTB/vTYkjZHw5kBrnHUlkF1OLKOVr6DlifgKvx+49wZ2Zf4OASHSFaisU7HRnZnLNJPIUNeB9qmDSyPyLeIcrfxTvlx8+hkfW2Guf2QOvds5anUHlbBmTxGZhjVu4JeMkDw4fRW5hFfoJZ3HkJFS1WnDBw1ohLSiTqFOUeb6BsSbj5NbQPZEhSXNNnJRbNNKjlG6j65qykNP67Wsa1WmQ5+3TeSdBfimxT/xtYrF+pRAtS+w1yCLSUcJKADYzV1Jir1j7CdU0U2/SrCqoFj11icp48JXp2VrXmlTeTLZhJhqEY7x1iKprPNHLZsjISAZe0ZGIVtoOwxAvHADmmqj+HR04szdCe+2Fhs6NgKpePVW6OT6f1ESkzTrF8EpFGlm/A/goGHQnkp2j6O27n2ZYdCQVT/DUrS7ThGFaR4n0vB5GqK6TJ8xavbC912ihRT1Pm7vHfFRh66Q039kxfeb46zY4QqmV3np/L0Ru2Itl6yFOhQzep6AGK4UC/TvOHysjuHfGxB+b1Tg2HrkHxfVyk8ZfAqZRtJLbdbr0LVxr3dwerwkItRNTg0cmj4ParJMBAfJQBm9Mg+oVSZedFIpKEHeU1G2ny5tUKeUD6+GZIV7ldH6mnZUXrsOHpv7tDmrkb59ivTVKHfxP\",\"base64\"));\n\n  codePointAt = function(str, idx) {\n    var code, hi, low;\n    idx = idx || 0;\n    code = str.charCodeAt(idx);\n    if ((0xD800 <= code && code <= 0xDBFF)) {\n      hi = code;\n      low = str.charCodeAt(idx + 1);\n      if ((0xDC00 <= low && low <= 0xDFFF)) {\n        return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;\n      }\n      return hi;\n    }\n    if ((0xDC00 <= code && code <= 0xDFFF)) {\n      hi = str.charCodeAt(idx - 1);\n      low = code;\n      if ((0xD800 <= hi && hi <= 0xDBFF)) {\n        return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;\n      }\n      return low;\n    }\n    return code;\n  };\n\n  shouldBreak = function(previous, current) {\n    if (previous === CR && current === LF) {\n      return false;\n    } else if (previous === Control || previous === CR || previous === LF) {\n      return true;\n    } else if (current === Control || current === CR || current === LF) {\n      return true;\n    } else if (previous === L && (current === L || current === V || current === LV || current === LVT)) {\n      return false;\n    } else if ((previous === LV || previous === V) && (current === V || current === T)) {\n      return false;\n    } else if ((previous === LVT || previous === T) && current === T) {\n      return false;\n    } else if (previous === Regional_Indicator && current === Regional_Indicator) {\n      return false;\n    } else if (current === Extend) {\n      return false;\n    } else if (current === SpacingMark) {\n      return false;\n    }\n    return true;\n  };\n\n  exports.nextBreak = function(string, index) {\n    var i, next, prev, _i, _ref1, _ref2, _ref3, _ref4;\n    if (index == null) {\n      index = 0;\n    }\n    if (index < 0) {\n      return 0;\n    }\n    if (index >= string.length - 1) {\n      return string.length;\n    }\n    prev = classTrie.get(codePointAt(string, index));\n    for (i = _i = _ref1 = index + 1, _ref2 = string.length; _i < _ref2; i = _i += 1) {\n      if ((0xd800 <= (_ref3 = string.charCodeAt(i - 1)) && _ref3 <= 0xdbff) && (0xdc00 <= (_ref4 = string.charCodeAt(i)) && _ref4 <= 0xdfff)) {\n        continue;\n      }\n      next = classTrie.get(codePointAt(string, i));\n      if (shouldBreak(prev, next)) {\n        return i;\n      }\n      prev = next;\n    }\n    return string.length;\n  };\n\n  exports.previousBreak = function(string, index) {\n    var i, next, prev, _i, _ref1, _ref2, _ref3;\n    if (index == null) {\n      index = string.length;\n    }\n    if (index > string.length) {\n      return string.length;\n    }\n    if (index <= 1) {\n      return 0;\n    }\n    index--;\n    next = classTrie.get(codePointAt(string, index));\n    for (i = _i = _ref1 = index - 1; _i >= 0; i = _i += -1) {\n      if ((0xd800 <= (_ref2 = string.charCodeAt(i)) && _ref2 <= 0xdbff) && (0xdc00 <= (_ref3 = string.charCodeAt(i + 1)) && _ref3 <= 0xdfff)) {\n        continue;\n      }\n      prev = classTrie.get(codePointAt(string, i));\n      if (shouldBreak(prev, next)) {\n        return i + 1;\n      }\n      next = prev;\n    }\n    return 0;\n  };\n\n  exports[\"break\"] = function(str) {\n    var brk, index, res;\n    res = [];\n    index = 0;\n    while ((brk = exports.nextBreak(str, index)) < str.length) {\n      res.push(str.slice(index, brk));\n      index = brk;\n    }\n    if (index < str.length) {\n      res.push(str.slice(index));\n    }\n    return res;\n  };\n\n  exports.countBreaks = function(str) {\n    var brk, count, index;\n    count = 0;\n    index = 0;\n    while ((brk = exports.nextBreak(str, index)) < str.length) {\n      index = brk;\n      count++;\n    }\n    if (index < str.length) {\n      count++;\n    }\n    return count;\n  };\n\n}).call(this);\n\n}).call(this,require(\"buffer\").Buffer)\n},{\"./classes.json\":19,\"buffer\":1,\"unicode-trie\":5}],19:[function(require,module,exports){\nmodule.exports={\"Other\":0,\"CR\":1,\"LF\":2,\"Control\":3,\"Extend\":4,\"Regional_Indicator\":5,\"SpacingMark\":6,\"L\":7,\"V\":8,\"T\":9,\"LV\":10,\"LVT\":11}\n},{}],20:[function(require,module,exports){\nGraphemeBreaker = require('grapheme-breaker');\n\n},{\"grapheme-breaker\":18}]},{},[20]);\n" + ";var self; selector._f = function(val, path) { var nil = undefined, schemaOnly = val === undefined"]
            .concat(this.gen.generated).join(",") + ";\nctx.reset(path, val);" +
            fnbody + "}; self = function (val, path) {" + (this.selector.begin ? "selector.begin();" : "") + " return selector._f(val, path) }; self.fn = selector._f; return self; ";
        try {
            fnout = new Function("selector", "schemas", "innerFns", "ctx", fnbody);
        } catch (e) {
            console.error(fnbody);
            throw e;
        }
        return fnout(this.selector, this.shared.schemas, this.shared.innerFns, new CurrentObject());
    }
};


function compile(userSchema, selectorCtor, options, path) {
    return new Compiler(userSchema, selectorCtor, options, path).compile();
}

module.exports = compile;

},{"./int/code":2,"./int/context":3,"./int/gen":4,"./int/processor":5,"./int/shared":6}],2:[function(require,module,exports){
"use strict";
var Generator = require('./gen');
var interpolate = require('../interpolate');

function CodeComposer() {
    this.codeLines = [];
    this.labelgen = new Generator('clabel');
}

CodeComposer.prototype = {
    pop: function () {
        this.codeLines.pop();
    },

    code: function (template) {
        this.codeLines.push(interpolate(template).apply(null, [].slice.call(arguments, 1)));
    },

    inline: function (fnInline, varName, stopLabel, allowReturn) {
        var fnbody = fnInline.toString()
                .replace(/^function\s*\([^)]*\)/, "")
                .replace(/_/g, varName),
            label = this.labelgen.next(),
            needLabel = fnbody.indexOf('return') !== -1;
        fnbody = fnbody.replace(/ctx\.stop\(\)/, "break " + stopLabel);
        if (!allowReturn) {
            fnbody = fnbody.replace(/return/g, "break " + label);
        }
        if (needLabel) {
            this.code("%%:{%%}", label, fnbody);
        } else {
            this.code(fnbody);
        }
    }
};

module.exports = CodeComposer;
},{"../interpolate":7,"./gen":4}],3:[function(require,module,exports){
"use strict";

function CurrentObject(path) {
    this.path = path ? path.slice() : [];
    this.stack = new Array(100);
    this.si = 0;
    this.parent = null;
    this.property = null;
    this.self = null;
}

CurrentObject.prototype = {
    reset: function (path, self) {
        this.path = path ? path.slice() : [];
        this.self = self;
    },
    replace: function (newVal) {
        this.parent[this.property] = newVal;
    },
    remove: function () {
        delete this.parent[this.property];
    },
    push: function (prop, parent, self) {
        this.path.push(prop);
        this.stack[this.si] = [prop, parent, self];
        this.si = this.si + 1;
        this.property = prop;
        this.parent = parent;
        this.self = self;
    },
    stop: function () {
        this.stopped = true;
    },
    isStopped: function () {
        if (this.stopped) {
            this.stopped = false;
            return true;
        }
        return false;
    },
    pop: function () {
        this.si = this.si - 1;
        this.path.pop();
        var last = this.stack[this.si];
        if (last) {
            this.parent = last[0];
            this.property = last[1];
            this.self = last[2];
        }
    }
};

module.exports = CurrentObject;
},{}],4:[function(require,module,exports){
"use strict";

function Generator(prefix) {
    this.i = 0;
    this.prefix = prefix;
    this.generated = [];
}

Generator.prototype = {
    next: function () {
        this.i = this.i + 1;
        var nv = this.prefix + this.i;
        this.generated.push(nv);
        return nv;
    }
};

module.exports = Generator;
},{}],5:[function(require,module,exports){
"use strict";
var Generator = require('./gen');

function SchemaPartProcessor(vargen, codeComposer, options) {
    this.vargen = vargen;
    this.labelgen = new Generator('label');
    this.codeComposer = codeComposer;
    this.options = options;
}


SchemaPartProcessor.prototype = {

    processors: ['processItems', 'processProperties'],

    execute: function (step) {
        this.processors.forEach(function (p) {
            this[p](step);
        }.bind(this));
    },

    createVar: function () {
        return this.vargen.next();
    },

    code: function () {
        this.codeComposer.code.apply(this.codeComposer, arguments);
    }
};

SchemaPartProcessor.prototype.processItems = function (step) {
    if (!step.schema.items && !step.schema.additionalItems) {
        return;
    }
    var idxvar, newvar, k;
    if (!Array.isArray(step.schema.items)) {
        idxvar = this.createVar();
        this.codeComposer.code("for (%% = 0; %%  < (%% ? %%.length : 0); %%++) {", idxvar, idxvar, step.varName, step.varName, idxvar);
        newvar = this.createVar();
        this.codeComposer.code("%% = %%[%%]", newvar, step.varName, idxvar);
        step.next(step.schema.items, newvar, "[]", idxvar, "item");
        this.code("}");
        if (!this.options.ignoreSchemaOnly) {
            this.code("if (schemaOnly) {");
            step.next(step.schema.items, 'nil', "[]", undefined, "item");
            this.code("}");
        }
    } else {
        for (k = 0; k < step.schema.items.length; k = k + 1) {
            newvar = this.createVar();
            this.code("%% = %% ? %%[%%] : undefined", newvar, step.varName, step.varName, k);
            step.next(step.schema.items[k], newvar, k);
        }
        if (!this.options.ignoreAdditionalItems) {
            idxvar = this.createVar();
            this.code("for (%% = %%; %% < (%% ? %%.length : 0); %%++) {", idxvar, step.schema.items.length, idxvar, step.varName, step.varName, idxvar);
            newvar = this.createVar();
            this.code("%% = %%[%%]", newvar, step.varName, idxvar);
            this.processAdditional(step, "additionalItems", "additionalItem", idxvar, newvar);
            this.code("}");
        }
    }

};

SchemaPartProcessor.prototype.processProperties = function (step) {
    if (!step.schema.properties && !step.schema.additionalProperties && !step.schema.patternProperties) {
        return;
    }
    var propsVar, newvar, k;
    if (!this.options.ignoreAdditionalItems) {
        propsVar = this.createVar();
        this.code("%% = {}", propsVar);
    }
    for (k in step.schema.properties) {
        if (step.schema.properties.hasOwnProperty(k)) {
            newvar = this.createVar();
            this.code("%% = %% ? %%.%% : undefined", newvar, step.varName, step.varName, k);
            if (!this.options.ignoreAdditionalItems) {
                this.code("%%.%% = true", propsVar, k);
            }
            step.next(step.schema.properties[k], newvar, k);
        }
    }
    if (!this.options.ignoreAdditionalItems) {
        this.processAdditionalProperties(step, propsVar);
    }
};

SchemaPartProcessor.prototype.processAdditionalProperties = function (step, propsVar) {
    var idxvar, newvar, k;
    idxvar = this.createVar();
    newvar = this.createVar();
    this.code("if (typeof %% === 'object' && !Array.isArray(%%)) for (%% in %%) if (%%.hasOwnProperty(%%)) {",
        step.varName, step.varName, idxvar, step.varName, step.varName, idxvar
        );
    this.code("%% = %%[%%]", newvar, step.varName, idxvar);
    for (k in (step.schema.patternProperties || {})) {
        if (step.schema.patternProperties.hasOwnProperty(k)) {
            this.code("if (/%%/.test(%%)) {", k, idxvar);
            step.next(step.schema.patternProperties[k], newvar, k, idxvar);
            this.code("%%[%%] = true", propsVar, idxvar);
            this.code("}");
        }
    }
    this.code("if (!%%[%%]) {", propsVar, idxvar);
    this.processAdditional(step, "additionalProperties", "additionalProperty", idxvar, newvar);
    this.code("}");
    this.code("}");
};

SchemaPartProcessor.prototype.processAdditional = function (step, schemaProp, cbProp, idxvar, newvar) {
    var stubSchema = {};
    stubSchema[cbProp] = false;
    if (step.schema[schemaProp] === false) {
        step.next(stubSchema, newvar, "*", idxvar);
    } else if (typeof step.schema[schemaProp] === 'object') {
        step.next(step.schema[schemaProp], newvar, "*", idxvar);
    } else {
        stubSchema[cbProp] = "allowed";
        step.next(stubSchema, newvar, "*", idxvar);
    }
};


module.exports = SchemaPartProcessor;
},{"./gen":4}],6:[function(require,module,exports){
"use strict";

function Shared() {
    this.innerFns = [];
    this.schemas = [];
}

Shared.prototype = {
    inner: function (fn) {
        this.innerFns.push(fn);
        return "innerFns[" + (this.innerFns.length - 1) + "]";
    },
    schema: function (s) {
        this.schemas.push(s);
        return "schemas[" + (this.schemas.length - 1) + "]";
    }
};

module.exports = Shared;
},{}],7:[function(require,module,exports){
"use strict";

var compiled = {};

function interpolate(template) {
    if (compiled[template]) {
        return compiled[template];
    }
    var list = template.split("%%"),
        code = "return " + ["list[0]", "a", "list[1]", "b", "list[2]", "c", "list[3]", "d", "list[4]", "e", "list[5]", "f", "list[6]", "g", "list[7]"].slice(0, list.length * 2 - 1).join("+"),
        fn = (new Function("list", "return function(a,b,c,d,e,f,g){" + code + "};"))(list);
    compiled[template] = fn;
    return fn;
}
module.exports =  interpolate;

},{}],8:[function(require,module,exports){
"use strict";

module.exports = function messages(gettext) {
    return {
        "string": gettext("shall be a string"),
        "null": gettext("shall be null"),
        "minLength": gettext("shall have length at least %d"),
        "maxLength": gettext("shall have length no more than %d"),
        "pattern": gettext("shall match pattern %s"),
        "integer": gettext("shall be an integer"),
        "multipleOf": gettext("shall be multiple of %d"),
        "number": gettext("shall be a number"),
        "minimum": gettext("shall be >= %d"),
        "minimum.exclusive": gettext("shall be > %d"),
        "maximum": gettext("shall be <= %d"),
        "maximum.exclusive": gettext("shall be < %d"),
        "boolean": gettext("shall be boolean"),
        "object": gettext("shall be object"),
        "additionalProperties": gettext("shall not have additional properties"),
        "minProperties": gettext("shall have at least %d properties"),
        "maxProperties": gettext("shall have no more than %d properties"),
        "array": gettext("shall be array"),
        "additionalItems": gettext("shall not have additional items"),
        "minItems": gettext("shall have at least %d items"),
        "maxItems": gettext("shall have no more %d items"),
        "uniqueItems": gettext("shall have unique items"),
        "enum": gettext("shall be one of values %s"),
        "required": gettext("is required"),
        "dependency": gettext("does not meet additional requirements for %s"),
        "not": gettext("does not meet 'not' requirement"),
        "oneOf": gettext("does not meet exactly one requirement"),
        "oneOf.zero": gettext("does not meet any requirement"),
        "allOf": gettext("does not meet all requirements"),
        "anyOf": gettext("does not meet any requirement"),
        "custom": gettext("is not valid")
    };
}

},{}],9:[function(require,module,exports){
"use strict";

function Normalizer() {

}

Normalizer.prototype = {
    "[default]": function (schema, object, ctx) {
        if (object === null || object === undefined) {
            ctx.replace(schema.default);
        }
    },
    "[additionalProperty]": function (schema, object, ctx) {
        ctx.remove();
    },
    "[type]": function (schema, object, ctx, next) {
        if (object === null || object === undefined) return;
        switch (schema.type) {
            case 'null':
                ctx.replace(null);
                break;
            case 'string':
                ctx.replace(object.toString());
                break;
            case 'integer':
                ctx.replace(parseInt(object));
                break;
            case 'number':
                ctx.replace(parseFloat(object));
                break;
            case 'boolean':
                var isTrue = ['true', 'on'].indexOf(object.toLowerCase()) != -1;
                var isFalse = ['false', 'off'].indexOf(object.toLowerCase()) != -1;
                ctx.replace(isTrue ? true: (isFalse ? false : !!object));
                break;
            case 'array':
                if (!Array.isArray(object)) {
                    ctx.replace([object]);
                }
                break;
            case 'object':
                break;
        }
    },
    end: {inline: "return _"}
};

Normalizer.factory = function() {
    return new Normalizer();
};
module.exports = Normalizer;
},{}],10:[function(require,module,exports){
"use strict";
var messages = require('./messages');

function isObject(o) {
    return typeof o === 'object' && !Array.isArray(o) && o !== null;
}

function fillDefaultFormats(formats) {
    formats.email = formats.email || {
        regexp: /^[^@]+@[^@]+$/,
        message: "shall be valid email"
    };
    formats["date-time"] = formats["date-time"] || {
        regexp: /^\d{4}-(?:0[0-9]{1}|1[0-2]{1})-[0-9]{2}[tT ]\d{2}:\d{2}:\d{2}(\.\d+)?([zZ]|[+\-]\d{2}:\d{2})$/,
        message: "shall be valid date"
    };
    formats.ipv4 = formats.ipv4 || {
        regexp: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
        message: "shall be valid ipv4 address"
    };
    formats.ipv6 = formats.ipv6 || {
        regexp: /^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/,
        message: "shall be valid ipv6 address"
    };
    formats.uri = formats.uri || {
        regexp:  /^[a-zA-Z][a-zA-Z0-9+-.]*:[^\s]*$/,
        message: "shall be valid URI"
    };
    formats.hostname = formats.hostname || {
        regexp:  /^([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])(\.([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9]))*$/,
        message: "shall be valid host name"
    };
}

function V4Validator(options) {
    this.options = options || {};
    if (!this.options.gettext) {
        this.options.gettext = function (s) { return s; };
    }
    if (!this.options.messages) {
        this.options.messages = messages(this.options.gettext);
    }
    this.options.custom = this.custom = this.options.custom || {};
    this.options.formats = this.formats = this.options.formats || {};
    fillDefaultFormats(this.formats);
    this.errors = [];
    this.res = {
        valid: true,
        errors: this.errors
    };
}

V4Validator.prototype = {
    toComparable: function (o) {
        return typeof o === 'object' ? JSON.stringify(o) : o;
    },
    error: function (code, ctx, arg) {
        var msg = this.$cm ? this.options.gettext(this.$cm[code]) : this.options.messages[code] || arg || (function () {throw new Error("There is no message registered for error '" + code + "'"); }());
        this.$cm = undefined;
        this.errors.push({
            code: code,
            message: msg,
            value: ctx.self,
            arg: arg,
            path: ctx.path.slice()
        });
    },
    copyErrors: function (anotherErrors) {
        this.errors.splice.apply(this.errors, [this.errors.length, 0].concat(anotherErrors));
    },

    "[messages]": function (s) {
        this.$messages = this.$messages || [];
        this.$messages.push(s.messages);
        return {inline: "this.$cm = this.$messages[" + (this.$messages.length - 1) + "]"};
    },

    "[messages]:end": {inline: "this.$cm = undefined;"},

    ////////////// type & common


    "[^required]": {prepare: function (s, ctx) {
        if (!ctx.parent) {
            return null;
        }
        return {inline: "if (_ === undefined) ctx.stop()"};
    }},
    "[type=string]": {inline: function (_, ctx) {
        if (typeof _ !== 'string') {
            this.error('string', ctx);
        }
    }},
    "[type=number]": {inline: function (_, ctx) {
        if (typeof _ !== 'number') {
            this.error('number', ctx);
        }
    }},
    "[type=integer]": {inline: function (_, ctx) {
        if ((typeof _ !== 'number') || (_ % 1 !== 0)) {
            this.error('integer', ctx);
        }
    }},
    "[type=null]": {inline: function (_, ctx) {
        if (_ !== null) {
            this.error('null', ctx);
        }
    }},
    "[type=boolean]": {inline: function (_, ctx) {
        if (typeof _ !== 'boolean') {
            this.error('boolean', ctx);
        }
    }},
    "[type=array]": {inline: function (_, ctx) {
        if (!Array.isArray(_)) {
            this.error('array', ctx);
        }
    }},
    "[type=object]": {inline: function (_, ctx) {
        if (Array.isArray(_) || typeof _ !== 'object' || _ === null) {
            this.error('object', ctx);
        }
    }},
    "[type]": function (schema) {
        if (Array.isArray(schema.type)) {
            var fns = [];
            var i;
            for (i = 0; i < schema.type.length; i++) {
                fns.push(this["[type=" + schema.type[i] + "]"].inline);
            }
            return function (s, o, ctx) {
                var old = this.errors;
                var newErrs = [];
                this.errors = newErrs;
                var i;
                for (i = 0; i < fns.length; i++) {
                    fns[i].call(this, o, ctx);
                }

                this.errors = old;
                if (newErrs.length === fns.length) {
                    this.copyErrors(newErrs);
                }

            };
        }
    },

    //////////////// dependencies

    "[dependencies]": function (schema, ctx) {
        var prop, icode = [], dep, fnName;

        for (prop in schema.dependencies) {
            if (schema.dependencies.hasOwnProperty(prop)) {
                dep = schema.dependencies[prop];
                if (Array.isArray(dep)) {
                    dep = {required: dep};
                }
                fnName = 'dep' + prop;
                ctx.compile(dep, fnName);

                icode.push("if (_.hasOwnProperty('" + prop + "')) {");
                icode.push("var res = ctx." + fnName + "(_);");
                icode.push("if (!res.valid) { this.error('dependency', ctx, " + JSON.stringify(schema.dependencies[prop]) + "); this.copyErrors(res.errors); }");
                icode.push("}");
            }
        }
        return {inline: icode.join("\n")};
    },

    //////////////// combining

    "[allOf]": {inline: function (_, ctx) {
        var i, res;
        for (i = 0; i < ctx.allOf.length; i++) {
            res = ctx.allOf[i](_, ctx.path);

            if (!res.valid) {
                this.error("allOf", ctx);
                this.copyErrors(res.errors);
            }
        }
    }},

    "[anyOf]": {inline: function (_, ctx) {
        var allErrors = [], res, i;
        for (i = 0; i < ctx.anyOf.length; i++) {
            res = ctx.anyOf[i](_, ctx.path);
            allErrors = allErrors.concat(res.errors);
            if (res.valid) {
                break;
            }
        }
        if (!res.valid) {
            this.error("anyOf", ctx);
            this.copyErrors(allErrors);
        }
    }},

    "[oneOf]": {inline: function (_, ctx) {
        var count = 0, allErrors = [], res, i;
        for (i = 0; i < ctx.oneOf.length; i++) {
            res = ctx.oneOf[i](_, ctx.path);
            allErrors = allErrors.concat(res.errors);
            if (res.valid) {
                count++;
            }
        }
        if (count === 0) {
            this.error("oneOf.zero", ctx);
            this.copyErrors(allErrors);
        } else if (count !== 1) {
            this.error("oneOf", ctx);
        }

    }},

    "[not]": {inline: function (_, ctx) {
        var res = ctx.not(_, ctx.path);
        if (res.valid) {
            this.error("not", ctx);
        }
    }},


    ///////////////// enum
    "[enum]": function (schema) {
        this.$enums = this.$enums || [];
        var $enum = {}, i, e;
        for (i = 0; i < schema.enum.length; i++) {
            e = schema.enum[i];
            $enum[this.toComparable(e)] = 1;
        }
        this.$enums.push($enum);
        return {inline: "if(!this.$enums[" + (this.$enums.length-1) + "][this.toComparable(_)]) this.error('enum', ctx, " + JSON.stringify(schema.enum) + ")"};
    },

    //////////////// string

    "xLength": function (op, count, code) {
        return {inline: "if (typeof _ === 'string' && GraphemeBreaker.countBreaks(_) " + op + count + ") this.error('" + code + "', ctx, " + count + ")"};
    },

    "[maxLength]": function (schema) {
        return this.xLength(">", schema.maxLength, 'maxLength');
    },
    "[minLength]": function (schema) {
        return this.xLength("<", schema.minLength, 'minLength');
    },
    "[pattern]": function (schema) {
        return {inline: "if (typeof _ === 'string' && !_.match(/" + schema.pattern + "/)) this.error('pattern', ctx, " + JSON.stringify(schema.pattern) + ")"};
    },
    "[format]": function (schema) {
        var fmt = this.formats[schema.format];
        if (!fmt) {
            throw new Error("Unknown format '" + schema.format + "'. Did you forget to register it?");
        }
        return {inline: "if (typeof _ === 'string' && !_.match(" + fmt.regexp + ")) this.error('format." + schema.format + "', ctx, " + JSON.stringify(fmt.message) + ")"};
    },

    ////////////////// array

    "[additionalItem=false]": {inline: function (_, ctx) {
        this.error("additionalItems", ctx);
    }},

    "xItems": function (op, count, code) {
        return {
            inline: "if(Array.isArray(_) && _.length " + op + count + ") this.error('" + code + "', ctx)"
        };
    },

    "[minItems]": function (schema) {
        return this.xItems("<", schema.minItems, "minItems");
    },

    "[maxItems]": function (schema) {
        return this.xItems(">", schema.maxItems, "maxItems");
    },

    "[uniqueItems]": {inline: function (_, ctx) {
        if (!Array.isArray(_)) {
            return;
        }

        var its = {}, i, o;
        for (i = 0; i < _.length; i = i + 1) {
            o = this.toComparable(_[i]);
            if (its[o]) {
                this.error("uniqueItems", ctx, _[i]);
            }
            its[o] = true;
        }
    }},

    processRequired: function(reqs) {
        if (Array.isArray(reqs)) {
            return function (s, o, ctx) {
                if (!isObject(o)) {
                    return;
                }
                var i;
                for (i = 0; i < reqs.length; i++) {
                    if (!o.hasOwnProperty(reqs[i])) {
                        this.error("required", ctx, null, reqs[i]);
                    }

                }
            };
        }
    },

    ///////////////// object
    "[required][^properties]": function (schema) {
        return this.processRequired(schema.required);

    },

    "[properties]": function (schema) {
        var $keys = Object.keys(schema.properties);
        var reqs = (schema.required || []).concat($keys.filter(function (key) {
            return schema.properties[key].required === true;
        }));
        return this.processRequired(reqs);
    },

    "xProperties": function (op, count, code) {
        return {inline: "if (typeof _ === 'object' && Object.keys(_).length " + op + " " + count + ") this.error('" + code + "', ctx, " + count + ")"};
    },

    "[maxProperties]": function (schema) {
        return this.xProperties(">", schema.maxProperties, 'maxProperties');
    },

    "[minProperties]": function (schema) {
        return this.xProperties("<", schema.minProperties, 'minProperties');
    },

    "[additionalProperty=false]": {inline: function (_, ctx) {
        this.error("additionalProperties", ctx);
    }},

    ///////////////// number
    "[multipleOf]": function (schema) {
        return {inline: "if (typeof _ === 'number' && (_ / " + schema.multipleOf + ") % 1 !== 0) this.error('multipleOf', ctx, " + schema.multipleOf + ")" };
    },

    "ximum": function (op, excl, count, code) {
        return {inline: "if (_ " + op +  (excl ? "=" : "") + count + ") this.error('" + code + (excl ? ".exclusive" : "") + "', ctx, " + count + ")"};
    },
    "[minimum]": function (schema) {
        return this.ximum("<", schema.exclusiveMinimum, schema.minimum, 'minimum');
    },
    "[maximum]": function (schema) {
        return this.ximum(">", schema.exclusiveMaximum, schema.maximum, 'maximum');
    },

    ///////////////// custom
    "[conform]": function (schema) {
        this.$custom = this.$custom || [];
        if (typeof schema.conform === 'function') {
            this.$custom.push(schema.conform);
            return {inline: "if (!this.$custom[" + (this.$custom.length - 1) + "](_, ctx)) this.error('custom', ctx)"};
        }
        var inlines = [];
        var k, fn, args;
        for (k in schema.conform) {
            if (schema.conform.hasOwnProperty(k)) {
                fn = this.custom[k];
                args = schema.conform[k] === true ? "" : schema.conform[k].map(JSON.stringify).concat([""]).join(',');
                this.$custom.push(fn);
                inlines.push("if (!this.$custom[" + (this.$custom.length - 1) + "](_, " + args + " ctx)) this.error('custom." + k + "', ctx, this.options.messages.custom)");
            }
        }
        return {inline: inlines.join('\n')};
    },

    ///////////////// result

    end: {inline: function () {
        this.res.valid = this.errors.length === 0;
        return this.res;
    }},

    begin: function () {
        this.errors = this.res.errors = [];
        this.res.valid = true;
        delete this.$cm;
    }

};
V4Validator.prototype.constructor = V4Validator;

V4Validator.factory = function (options) {
    return function () {
        return new V4Validator(options);
    };
};

V4Validator.extend = function (override) {
    function NewValidator (options) {
        V4Validator.call(this, options);
    }

    NewValidator.prototype = new V4Validator();
    NewValidator.prototype.constructor = NewValidator;
    var k;
    for (k in override) {
        if (override.hasOwnProperty(k)) {
            NewValidator.prototype[k] = override[k];
        }
    }
    NewValidator.factory = function (options) {
        return function () {
            return new NewValidator(options);
        };
    };

    return NewValidator;
};


module.exports = V4Validator;
},{"./messages":8}],11:[function(require,module,exports){
"use strict";
var compile = require('./compiler-gb');
var Validator = require('./v4validator');
var Normalizer = require('./normalizer');
var interpolate = require('./interpolate');

module.exports = {
    Validator: Validator,
    Normalizer: Normalizer,
    compile: compile,

    newIterator: compile,

    newValidator: function (schema, voptions) {
        return compile(schema, Validator.factory(voptions), voptions);
    },
    newNormalizer: function (schema) {
        return compile(schema, Normalizer.factory);
    }
};

},{"./compiler-gb":1,"./interpolate":7,"./normalizer":9,"./v4validator":10}]},{},[11])(11)
});