/* Merging what two devices changed.

   Each device remembers the last copy it knew the server had (the "base"). When it finds the server has moved on, it has three
   copies: the base, its own (mine), and the server's (theirs). merge3 keeps every change either side made:
     - a field only one side changed takes that change;
     - a token, an initiative entry or any other item with an id is merged on its own, so "I moved it" and "you healed it" both stay;
     - new items from either side are kept, and an item either side deleted stays deleted;
     - if both sides changed the very same field, mine wins (the device doing the saving, which is the more recent action).
   applyInPlace then updates the page's own copy so it equals the merged result, reusing the same objects wherever it can, because
   other parts of the page (an open dialog, a token being held) are holding on to them. */

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]));
}

/* An array whose items are all objects with an id (tokens, initiative entries, objectives...) can be merged item by item. */
const idItems = (arr) => Array.isArray(arr) && arr.every((x) => isObj(x) && (typeof x.id === "string" || typeof x.id === "number"));
const idArrays = (...arrs) => arrs.every((a) => a === undefined || idItems(a)) && arrs.some((a) => Array.isArray(a) && a.length);

export function merge3(base, mine, theirs) {
  if (deepEq(mine, theirs)) return clone(mine);
  if (deepEq(mine, base)) return clone(theirs);   // I didn't touch it: take theirs
  if (deepEq(theirs, base)) return clone(mine);   // they didn't touch it: keep mine
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(b[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs) && idArrays(base, mine, theirs)) {
    const list = (a) => (Array.isArray(a) ? a : []);
    const map = (a) => new Map(list(a).map((x) => [x.id, x]));
    const B = map(base), M = map(mine), T = map(theirs);
    const baseIds = list(base).map((x) => x.id), mineIds = list(mine).map((x) => x.id), theirIds = list(theirs).map((x) => x.id);
    // who set the order? If I moved things around, my order; otherwise theirs.
    const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const iReordered = !sameOrder(mineIds.filter((id) => B.has(id)), baseIds.filter((id) => M.has(id)));
    const order = iReordered ? [...mineIds, ...theirIds] : [...theirIds, ...mineIds];
    const seen = new Set(), out = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (B.has(id) && (!M.has(id) || !T.has(id))) continue;   // deleted on one side: stays deleted
      const item = merge3(B.get(id), M.get(id), T.get(id));
      if (item !== undefined) out.push(item);
    }
    return out;
  }
  return clone(mine);   // both changed the same plain value: mine wins
}

/* Make `target` equal `source`, changing as little as possible and keeping the objects that already exist. Returns true if anything changed. */
export function applyInPlace(target, source) {
  if (deepEq(target, source)) return false;
  if (isObj(target) && isObj(source)) {
    for (const k of Object.keys(target)) if (!(k in source) || source[k] === undefined) delete target[k];
    for (const k of Object.keys(source)) {
      if (source[k] === undefined) continue;
      if (isObj(target[k]) && isObj(source[k])) applyInPlace(target[k], source[k]);
      else if (Array.isArray(target[k]) && Array.isArray(source[k])) applyInPlace(target[k], source[k]);
      else if (!deepEq(target[k], source[k])) target[k] = clone(source[k]);
    }
    return true;
  }
  if (Array.isArray(target) && Array.isArray(source)) {
    if (idItems(target) && idItems(source) && target.length + source.length) {
      const existing = new Map(target.map((x) => [x.id, x]));
      const next = source.map((s) => {
        const cur = existing.get(s.id);
        if (cur) { applyInPlace(cur, s); return cur; }   // the same object, brought up to date
        return clone(s);
      });
      target.splice(0, target.length, ...next);
    } else target.splice(0, target.length, ...clone(source));
    return true;
  }
  return false;   // different kinds of value at the top: the caller assigns it
}
