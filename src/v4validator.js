"use strict";

function messages(gettext) {
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

function isObject(o) {
    return typeof o === 'object' && !Array.isArray(o) && o !== null;
}

function fillDefaultFormats(formats) {
    formats.email = formats.email || {
        regexp: /^[^@]+@[^@]+$/,
        message: "shall be valid email"
    };
    formats["date-time"] = formats["date-time"] || {
        regexp: /^\d{4}-(?:0[0-9]{1}|1[0-2]{1})-[0-9]{2}[tT ]\d{2}:\d{2}:\d{2}(\.\d+)?([zZ]|[+-]\d{2}:\d{2})$/,
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
    this.custom = this.options.custom || {};
    this.formats = this.options.formats || {};
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
    error: function (code, ctx, arg, subpath) {
        var msg = this.$cm ? this.options.gettext(this.$cm[code]) : this.options.messages[code] || arg || (function () {throw new Error("There is no message registered for error '" + code + "'"); }());
        delete this.$cm;
        this.errors.push({
            code: code,
            message: msg,
            value: ctx.self,
            arg: arg,
            path: ctx.path.slice()
        });
    },
    errorIf: function (condition, code, ctx, arg, subpath) {
        if (condition) {
            this.error(code, ctx, arg, subpath);
        }
    },
    copyErrors: function (anotherErrors) {
        this.errors.splice.apply(this.errors, [this.errors.length, 0].concat(anotherErrors));
    },

    "[messages]": function (s, ctx) {
        this.$messages = this.$messages || [];
        this.$messages.push(s.messages);
        return {inline: "this.$cm = this.$messages[" + (this.$messages.length - 1) + "]"};
    },

    ////////////// type & common


    "[^required]": {prepare: function (s, ctx) {
        if (!ctx.parent) return null;
        return {inline: "if (_ === undefined) ctx.stop()"};
    }},
    "[type=string]": {inline: function (_, ctx) {
        if(typeof _ !== 'string') this.error('string', ctx);
    }},
    "[type=number]": {inline: function (_, ctx) {
        if(typeof _ !== 'number') this.error('number', ctx);
    }},
    "[type=integer]": {inline: function (_, ctx) {
        if((typeof _ !== 'number') || (_ % 1 !== 0)) this.error('integer', ctx);
    }},
    "[type=null]": {inline: function (_, ctx) {
        if(_ !== null) this.error('null', ctx);
    }},
    "[type=boolean]": {inline: function (_, ctx) {
        if(typeof _ !== 'boolean') this.error('boolean', ctx);
    }},
    "[type=array]": {inline: function (_, ctx) {
        if(!Array.isArray(_)) this.error('array', ctx);
    }},
    "[type=object]": {inline: function (_, ctx) {
        if(Array.isArray(_) || typeof _ !== 'object' || _ === null) this.error('object', ctx);
    }},
    "[type]": function (schema) {
        if (Array.isArray(schema.type)) {
            var fns = [];
            for (var i = 0; i < schema.type.length; i++) {
                fns.push(this["[type=" + schema.type[i] + "]"].inline);
            }
            return function (s, o, ctx) {
                var old = this.errors;
                var newErrs = [];
                this.errors = newErrs;
                for (var i = 0; i < fns.length; i++) {
                    fns[i].call(this, o, ctx);
                }

                this.errors = old;
                if (newErrs.length === fns.length) {
                    this.copyErrors(newErrs);
                }

            }
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
        return {inline: icode.join("\n")}
    },

    //////////////// combining

    "[allOf]": {inline: function (_, ctx) {
        for (var i = 0; i < ctx.allOf.length; i++) {
            var res = ctx.allOf[i](_, ctx.path);

            if (!res.valid) {
                this.error("allOf", ctx);
                this.copyErrors(res.errors);
            }
        }
    }},

    "[anyOf]": {inline: function (_, ctx) {
        var allErrors = [], res;
        for (var i = 0; i < ctx.anyOf.length; i++) {
            res = ctx.anyOf[i](_, ctx.path);
            allErrors = allErrors.concat(res.errors);
            if (res.valid) break;
        }
        if (!res.valid) {
            this.error("anyOf", ctx);
            this.copyErrors(allErrors);
        }
    }},

    "[oneOf]": {inline: function (_, ctx) {
        var count = 0, allErrors = [], res;
        for (var i = 0; i < ctx.oneOf.length; i++) {
            res = ctx.oneOf[i](_, ctx.path);
            allErrors = allErrors.concat(res.errors);
            if (res.valid) count++;
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
        var $enum = {};
        for (var i = 0; i < schema.enum.length; i++) {
            var e = schema.enum[i];
            $enum[this.toComparable(e)] = 1;
        }
        this.$enums.push($enum);
        return {inline: "if(!this.$enums[" + (this.$enums.length-1) + "][this.toComparable(_)]) this.error('enum', ctx, " + JSON.stringify(schema.enum) + ")"};
    },

    //////////////// string

    "xLength": function (op, count, code) {
        return {inline: "if (typeof _ === 'string' && _.length " + op + count + ") this.error('" + code + "', ctx, " + count + ")"}
    },

    "[maxLength]": function (schema) {
        return this.xLength(">", schema.maxLength, 'maxLength');
    },
    "[minLength]": function (schema) {
        return this.xLength("<", schema.minLength, 'minLength');
    },
    "[pattern]": function (schema) {
        return {inline: "if (typeof _ === 'string' && !_.match(/" + schema.pattern + "/)) this.error('pattern', ctx, " + JSON.stringify(schema.pattern) + ")"}
    },
    "[format]": function (schema) {
        var fmt = this.formats[schema.format];
        if (!fmt) {
            throw new Error("Unknown format '" + schema.format + "'. Did you forget to register it?");
        }
        return {inline: "if (typeof _ === 'string' && !_.match(" + fmt.regexp + ")) this.error('format." + schema.format + "', ctx, " + JSON.stringify(fmt.message) + ")"}
    },

    ////////////////// array

    "[additionalItem=false]": {inline: function (_, ctx) {
        this.error("additionalItems", ctx);
    }},

    "xItems": function (op, count, code) {
        return {
            inline: "if(Array.isArray(_) && _.length " + op + count + ") this.error('" + code + "', ctx)"
        }
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
            this.errorIf(its[o], "uniqueItems", ctx, _[i]);
            its[o] = true;
        }
    }},

    processRequired: function(reqs) {
        if (Array.isArray(reqs)) {
            return function (s, o, ctx) {
                if (!isObject(o)) return;
                var i;
                for (i = 0; i < reqs.length; i++) {
                    this.errorIf(!o.hasOwnProperty(reqs[i]), "required", ctx, null, reqs[i]);
                }
            }
        }
    },

    ///////////////// object
    "[required][^properties]": function (schema) {
        return this.processRequired(schema.required);

    },

    "[properties]": function (schema) {
        schema.$keys = Object.keys(schema.properties);
        var reqs = (schema.required || []).concat(schema.$keys.filter(function (key) {
            return schema.properties[key].required === true;
        }));
        return this.processRequired(reqs);
    },

    "xProperties": function (op, count, code) {
        return {inline: "if (typeof _ === 'object') this.errorIf(Object.keys(_).length " + op + " " + count + ", '" + code + "', ctx, " + count + ")"};
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
        return {inline: "if (typeof _ === 'number' ) this.errorIf((_ / " + schema.multipleOf + ") % 1 !== 0, 'multipleOf', ctx, " + schema.multipleOf + ")" }
    },

    "ximum": function (op, excl, count, code) {
        return {inline: "this.errorIf(_ " + op +  (excl ? "=" : "") + count + ", '" + code + (excl ? ".exclusive" : "") + "', ctx, " + count + ")"}
    },
    "[minimum]": function (schema) {
        return this.ximum("<", schema.exclusiveMinimum, schema.minimum, 'minimum');
    },
    "[maximum]": function (schema) {
        return this.ximum(">", schema.exclusiveMaximum, schema.maximum, 'maximum');
    },

    ///////////////// custom
    "[conform]": function (schema, ctx) {
        this.$custom = this.$custom || [];
        if (typeof schema.conform === 'function') {
            this.$custom.push(schema.conform);
            return {inline: "this.errorIf(!this.$custom[" + (this.$custom.length - 1) + "](_, ctx), 'custom', ctx)"}
        }
        else {
            var inlines = [];
            for (var k in schema.conform) {
                if (schema.conform.hasOwnProperty(k)) {
                    var fn = this.custom[k];
                    var args = schema.conform[k].map(JSON.stringify).concat([""]).join(',');
                    this.$custom.push(fn);
                    inlines.push("this.errorIf(!this.$custom[" + (this.$custom.length - 1) + "](_, " + args + " ctx), 'custom." + k + "', ctx, this.options.messages.custom)");
                }
            }
            return {inline: inlines.join('\n')};
        }
    },

    ///////////////// result

    done: {inline: function () {
        this.res.valid = this.errors.length === 0;
        return this.res;
    }},

    clone: function () {
        var v = new V4Validator(this.options);
        v.$enums = this.$enums;
        v.$custom = this.$custom;
        v.$messages = this.$messages;
        return v;
    },

    reset: function () {
        this.errors = this.res.errors = [];
        this.res.valid = true;
    }

};

V4Validator.factory = function (options) {
    return function () {
        return new V4Validator(options);
    }
};


module.exports = V4Validator;