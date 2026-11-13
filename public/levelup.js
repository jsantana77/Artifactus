/* The rules behind a level-up: which hit die a class uses, what a level is worth in hit points, and how many spell slots a class
   has at each level. Everything here is a suggestion the DM can change before applying it. */

export const LEVEL_MAX = 20;

const CLASSES = {
  barbarian: { name: "Barbarian", die: 12 },
  bard: { name: "Bard", die: 8, caster: "full" },
  cleric: { name: "Cleric", die: 8, caster: "full" },
  druid: { name: "Druid", die: 8, caster: "full" },
  fighter: { name: "Fighter", die: 10 },
  monk: { name: "Monk", die: 8 },
  paladin: { name: "Paladin", die: 10, caster: "half" },
  ranger: { name: "Ranger", die: 10, caster: "half" },
  rogue: { name: "Rogue", die: 8 },
  sorcerer: { name: "Sorcerer", die: 6, caster: "full" },
  warlock: { name: "Warlock", die: 8, caster: "pact" },
  wizard: { name: "Wizard", die: 6, caster: "full" },
  artificer: { name: "Artificer", die: 8, caster: "artificer" },
};

/* Read a class out of what a player typed ("Wizard", "Wizard (Evocation)", "Eldritch Knight"). Null when it isn't one we know.
   `multi` is set when it looks like more than one class, where a single table would be wrong. */
export function classInfo(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;
  const found = [];
  if (/eldritch\s+knight/.test(t)) found.push({ name: "Eldritch Knight", die: 10, caster: "third", at: t.search(/eldritch\s+knight/) });
  else if (/arcane\s+trickster/.test(t)) found.push({ name: "Arcane Trickster", die: 8, caster: "third", at: t.search(/arcane\s+trickster/) });
  for (const [k, c] of Object.entries(CLASSES)) {
    const at = t.search(new RegExp(`\\b${k}\\b`));
    if (at >= 0 && !found.some((f) => f.name === "Eldritch Knight" && k === "fighter") && !found.some((f) => f.name === "Arcane Trickster" && k === "rogue")) found.push({ ...c, at });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.at - b.at);
  const first = { ...found[0] };
  delete first.at;
  if (found.length > 1) first.multi = true;
  return first;
}

/* Slots by character level, level 1 first, as [1st, 2nd, 3rd...]. */
const FULL = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
const HALF = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2]];
const THIRD = [[], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3],
  [4, 3, 3, 1], [4, 3, 3, 1]];
/* A warlock has a few slots that are all the same level: [how many, which level]. */
const PACT = [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];

/* The slots a class has at a level, as { 1: 4, 2: 3 }. Null if the class doesn't cast (or we don't know it). */
export function slotsFor(info, level) {
  if (!info || !info.caster || info.multi) return null;
  const lv = Math.min(LEVEL_MAX, Math.max(1, Math.round(Number(level) || 1)));
  let row;
  if (info.caster === "full") row = FULL[lv - 1];
  else if (info.caster === "half") row = HALF[lv - 1];
  else if (info.caster === "third") row = THIRD[lv - 1];
  else if (info.caster === "artificer") row = FULL[Math.ceil(lv / 2) - 1];   // a half caster that rounds up
  else if (info.caster === "pact") { const [n, l] = PACT[lv - 1]; return { [l]: n }; }
  const out = {};
  (row || []).forEach((n, i) => { if (n) out[i + 1] = n; });
  return out;
}

const ORD = ["", "1st", "2nd", "3rd"];
export const slotText = (slots) => (slots && Object.keys(slots).length
  ? Object.keys(slots).map(Number).sort((a, b) => a - b).map((l) => `${ORD[l] || l + "th"} ${slots[l]}`).join(" · ") : "none");

/* Hit points a level is worth: the die's average (rounded up, as the rules suggest for a fixed value) plus Constitution, never below 1. */
export const hpPerLevel = (info, conMod) => (info ? Math.max(1, Math.floor(info.die / 2) + 1 + (Number(conMod) || 0)) : null);

/* "5d8" becomes "6d8"; anything else is left alone. */
export function hitDiceFor(info, level, current) {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(String(current || ""));
  if (m) return `${level}d${m[2]}`;
  if (!String(current || "").trim() && info && !info.multi) return `${level}d${info.die}`;   // empty: fill it in for a known class
  return null;
}
