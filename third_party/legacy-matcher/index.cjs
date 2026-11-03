'use strict';

// Project-owned API glue. No legacy minimatch parser or implementation is
// included: every pattern is processed by the separately audited fixed v11.
const modern = require('minimatch-modern');

function adapter(defaultOptions = {}) {
  // glob 7 consumes the parsed .set arrays directly. Preserve their old shape
  // while retaining v11's parser and security bounds. Callers' explicit options
  // still take precedence, including newer glob's optimization level.
  const optionsFor = (options) => ({ optimizationLevel: 0, ...defaultOptions, ...options });
  class LegacyMinimatch extends modern.Minimatch {
    constructor(pattern, options) {
      super(pattern, optionsFor(options));
      // glob 7 calls String.match(segment) and reads segment._glob. v11's
      // nonrecursive Matcher deliberately is not a RegExp. Keep that engine
      // and add only the legacy protocol/metadata expected by the walker.
      this.set = this.set.map((row, r) => row.map((segment, c) => {
        if (segment && typeof segment === 'object' && typeof segment.test === 'function') {
          const thisGlob = this.globParts[r][c];
          // Do not mutate shared cached Matchers used by modern consumers.
          return new Proxy(segment, {
            get(target, key) {
              if (key === '_glob') return thisGlob;
              if (key === Symbol.match) return filename => target.test(filename) ? [filename] : null;
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        }
        return segment;
      }));
    }
    // Preserve one legacy set row per expanded glob; parsing remains v11.
    mergeRows() {}
    static defaults(options) {
      return adapter({ ...defaultOptions, ...options }).Minimatch;
    }
  }
  const matcher = (filename, pattern, options) => modern.minimatch(filename, pattern, optionsFor(options));
  Object.assign(matcher, modern);
  matcher.Minimatch = LegacyMinimatch;
  matcher.filter = (pattern, options) => (filename) => matcher(filename, pattern, options);
  matcher.match = (filenames, pattern, options) => modern.match(filenames, pattern, optionsFor(options));
  matcher.makeRe = (pattern, options) => new LegacyMinimatch(pattern, options).makeRe();
  matcher.braceExpand = (pattern, options) => modern.braceExpand(pattern, optionsFor(options));
  matcher.defaults = (options) => adapter({ ...defaultOptions, ...options });
  matcher.minimatch = matcher;
  return matcher;
}

module.exports = adapter();
