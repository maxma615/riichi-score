// Diff the page's JSON view model into native setData paths. A changed container
// shape is replaced as a whole so removed array entries/object fields disappear.
function diff(previous, next, path, patch) {
  if (previous === next) return;
  if (Array.isArray(previous) && Array.isArray(next) && previous.length === next.length) {
    next.forEach((value, index) => diff(previous[index], value, `${path}[${index}]`, patch));
    return;
  }
  if (previous && next && typeof previous === "object" && typeof next === "object" &&
      !Array.isArray(previous) && !Array.isArray(next)) {
    const keys = Object.keys(next);
    if (Object.keys(previous).length === keys.length &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(previous, key))) {
      keys.forEach((key) => diff(previous[key], next[key], `${path}.${key}`, patch));
      return;
    }
  }
  patch[path] = next;
}

// next is a partial page model: omitted root fields stay untouched. Return the
// actual bridge payload ({} for a no-op) for callers collecting update metrics.
function patchView(host, next, done) {
  const patch = {};
  Object.keys(next).forEach((key) => diff(host.data[key], next[key], key, patch));
  // Keep logic atomic even before the native view applies its leaf-path payload.
  Object.assign(host.data, next);
  if (Object.keys(patch).length) host.setData(patch, done);
  else if (done) done();
  return patch;
}

module.exports = { patchView };
