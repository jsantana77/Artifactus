import { esc, uid } from "./common.js";
import { d20Btn, dmgBtn, critBtn, canRollDamage, rollifyText, spellRollButtons } from "./creaturerolls.js";

/* The structured parts of an NPC or enemy stat block: attacks, special abilities, and spellcasting.
   They are drawn the same way on a stat card, in the NPCs & Enemies editor, and in the combat window. */

export const sg = (n) => (n >= 0 ? "+" : "−") + Math.abs(n);
export const ord = (n) => ["", "1st", "2nd", "3rd"][n] || `${n}th`;
export const ABIL_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
export const ABIL_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export const ATTACK_KINDS = [["melee", "Melee weapon attack"], ["ranged", "Ranged weapon attack"], ["either", "Melee or ranged weapon attack"], ["spell", "Spell attack"], ["save", "Saving throw effect (no attack roll)"], ["other", "Other (no roll)"]];
export const FEATURE_TYPES = [["trait", "Trait"], ["action", "Action"], ["bonus", "Bonus action"], ["reaction", "Reaction"], ["legendary", "Legendary action"]];
const KIND_LABEL = { melee: "Melee Weapon Attack", ranged: "Ranged Weapon Attack", either: "Melee or Ranged Weapon Attack", spell: "Spell Attack", save: "", other: "" };

/* "1/4" and "2" both become numbers so challenge ratings sort properly. No rating sorts last. */
export function crValue(cr) {
  const t = String(cr ?? "").trim();
  if (!t) return Infinity;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : Infinity;
  const n = Number(t);
  return Number.isFinite(n) ? n : Infinity;
}

/* The proficiency bonus that goes with a challenge rating (the 5e table). */
export function profByCr(cr) {
  const v = crValue(cr);
  if (!Number.isFinite(v)) return 2;
  return v >= 29 ? 9 : v >= 25 ? 8 : v >= 21 ? 7 : v >= 17 ? 6 : v >= 13 ? 5 : v >= 9 ? 4 : v >= 5 ? 3 : 2;
}

/* The average of a dice formula, rounded down the way stat blocks do it: "2d6+4" is 11. Null if it isn't a formula. */
export function diceAvg(expr) {
  const s = String(expr ?? "").replace(/\s+/g, "").replace(/−/g, "-");
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== s) return null;
  let total = 0;
  for (const t of terms) {
    const m = /^([+-]?)(\d*)d(\d+)$/i.exec(t);
    if (m) total += (m[1] === "-" ? -1 : 1) * ((Number(m[2] || 1) * (Number(m[3]) + 1)) / 2);
    else if (/^[+-]?\d+$/.test(t)) total += Number(t);
    else return null;
  }
  return Math.floor(total);
}

/* ----- blank pieces ----- */
export const blankAttack = () => ({ id: uid(), name: "", kind: "melee", bonus: null, reach: "reach 5 ft.", damage: [{ dice: "", type: "" }], save: null, notes: "" });
export const blankFeature = (type = "trait") => ({ id: uid(), name: "", type, uses: "", cost: 1, text: "" });
export const blankSpell = (level = 1) => ({ id: uid(), name: "", level, uses: "", note: "" });
export const blankSpellcasting = () => ({ ability: "int", dc: null, atk: null, level: null, innate: false, slots: {}, spells: [] });

/* Make sure a creature (maybe saved before these existed) has every structured field. */
export function normalizeStats(c) {
  if (!Array.isArray(c.attacks)) c.attacks = [];
  if (!Array.isArray(c.features)) c.features = [];
  if (c.spellcasting && typeof c.spellcasting === "object") {
    const sc = c.spellcasting;
    if (!Array.isArray(sc.spells)) sc.spells = [];
    if (!sc.slots || typeof sc.slots !== "object") sc.slots = {};
  } else c.spellcasting = null;
  return c;
}

/* ----- one attack, as a line of a stat block ----- */
const dmgPart = (d) => {
  const dice = String(d.dice || "").trim(), type = String(d.type || "").trim();
  if (!dice && !type) return "";
  const avg = diceAvg(dice);
  return `<b>${avg != null && /d/i.test(dice) ? `${avg} (${esc(dice.replace(/\s+/g, ""))})` : esc(dice)}</b>${type ? ` ${esc(type)}` : ""}`;
};
export const damageHTML = (list) => (list || []).map(dmgPart).filter(Boolean).join(" plus ");

export function attackHTML(a) {
  const bits = [];
  const label = KIND_LABEL[a.kind];
  const name = a.name || "Attack";
  const hasSave = !!(a.save && a.save.ability);
  const saveBit = hasSave ? `DC ${esc(a.save.dc)} ${ABIL_NAMES[a.save.ability] || ""} save` : "";
  if (label) bits.push(`${label}${a.bonus != null ? ` ${d20Btn(`${sg(a.bonus)} to hit`, a.bonus, `${name} attack`, `data-aid="${esc(a.id)}"`, "text")}` : ""}`);
  if (String(a.reach || "").trim() && label) bits.push(esc(a.reach.trim()));
  if (!label && saveBit) bits.push(saveBit);   // a save with no attack roll: the save comes first
  const dmg = damageHTML(a.damage);
  if (dmg) bits.push((canRollDamage(a.damage) ? dmgBtn(dmg, a.damage, `${name} damage`, a.id, "text") + critBtn(a.damage, `${name} damage`, a.id) : dmg) + (!label && hasSave ? " on a failed save" : ""));
  if (label && saveBit) bits.push(saveBit);   // an attack that also forces a save (a poisoned sting): the save follows the damage
  if (hasSave && String(a.save.onSave || "").trim()) bits.push(esc(a.save.onSave.trim()));
  const notes = String(a.notes || "").trim();
  return `<p class="sc-feat sc-atk" data-atk="${esc(a.id)}"><b><i>${esc(a.name || "Attack")}.</i></b> ${bits.join(" · ")}${notes ? ` <span class="sc-more">${rollifyText(notes, name)}</span>` : ""}</p>`;
}

/* ----- one special ability or action ----- */
export function featureHTML(f) {
  const head = `${esc(f.name || "Ability")}${f.type === "legendary" && Number(f.cost) > 1 ? ` (Costs ${Number(f.cost)} Actions)` : ""}${String(f.uses || "").trim() ? ` (${esc(f.uses.trim())})` : ""}`;
  return `<p class="sc-feat" data-feat="${esc(f.id)}"><b><i>${head}.</i></b> ${rollifyText(f.text || "", f.name || "Ability")}</p>`;
}

/* Which collapsible parts of a card are open. `map` remembers what was opened or closed (key -> true/false) so a card that is
   redrawn (an HP change, say) doesn't snap shut. */
export function bindOpenState(container, map) {
  container.addEventListener("toggle", (e) => { const d = e.target; if (d?.dataset?.k) map.set(d.dataset.k, d.open); }, true);
}

/* ----- the open and shut parts of a card (shared with the player cards) ----- */
export function spellRow(s, lib, key, openMap, rolls = null) {
  const e = lib ? lib(s.name) : null;
  const meta = e ? [e.school, e.time, e.range].filter(Boolean).join(" · ") : "";
  const parts = [];
  if (e) {
    const line = [e.school, e.time, e.range, e.comp, e.dur].filter(Boolean).join(" · ");
    if (line) parts.push(`<p class="smeta">${esc(line)}</p>`);
    if (e.desc) parts.push(`<p>${esc(e.desc)}</p>`);
  }
  if (String(s.note || "").trim()) parts.push(`<p class="pcs-note"><b>Note:</b> ${esc(s.note)}</p>`);
  if (!parts.length) return `<div class="pcs-sp"><b>${esc(s.name)}</b></div>`;
  const k = `${key}:sp:${s.name}`;
  const rb = rolls && e ? spellRollButtons(e, s.name, rolls) : "";
  return `<details class="pcs-sp" data-k="${esc(k)}" ${openMap?.get(k) ? "open" : ""}><summary><b>${esc(s.name)}</b>${meta ? ` <small>${esc(meta)}</small>` : ""}${rb ? ` <span class="sprolls">${rb}</span>` : ""}</summary><div class="pcs-spbody">${parts.join("")}</div></details>`;
}

export function section(key, name, title, body, openMap, openByDefault) {
  const k = `${key}:${name}`;
  const open = openMap?.has(k) ? openMap.get(k) : openByDefault;
  return `<details class="pcs-sec" data-k="${esc(k)}" ${open ? "open" : ""}><summary>${title}</summary>${body}</details>`;
}

/* ----- spellcasting, as it reads in a stat block ----- */
export function spellcastingHTML(sc, opts = {}) {
  if (!sc) return "";
  const spells = (sc.spells || []).filter((s) => String(s.name || "").trim());
  const key = opts.key || "c";
  const numbers = [sc.dc != null ? `spell save DC ${esc(sc.dc)}` : "", sc.atk != null ? `${sg(sc.atk)} to hit with spell attacks` : ""].filter(Boolean).join(", ");
  const abil = sc.ability ? `${ABIL_NAMES[sc.ability]}${numbers ? ` (${numbers})` : ""}` : numbers;
  const intro = sc.innate
    ? `Its innate spellcasting ability is ${abil || "—"}. It can innately cast the following spells.`
    : `${Number(sc.level) > 0 ? `It is a ${ord(Number(sc.level))}-level spellcaster. ` : ""}Its spellcasting ability is ${abil || "—"}. It has the following spells prepared.`;
  let groups;
  if (sc.innate) {   // grouped by how often they can be cast: "At will", "3/day each"…
    const by = new Map();   // (capital letters don't matter: "At will" and "at will" are one group)
    for (const s of spells) { const u = String(s.uses || "").trim() || "At will"; const k = u.toLowerCase(); if (!by.has(k)) by.set(k, { label: u.charAt(0).toUpperCase() + u.slice(1), list: [] }); by.get(k).list.push(s); }
    const rank = (k) => (k === "at will" ? 0 : 1);
    groups = [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([, g]) => [g.label, g.list]);
  } else {
    const by = new Map();
    for (const s of spells) { const l = Number(s.level) || 0; if (!by.has(l)) by.set(l, []); by.get(l).push(s); }
    groups = [...by.keys()].sort((a, b) => a - b).map((l) => {
      const n = Number(sc.slots?.[l]) || 0;
      return [l === 0 ? "Cantrips (at will)" : `${ord(l)} level${n ? ` (${n} slot${n === 1 ? "" : "s"})` : ""}`, by.get(l)];
    });
  }
  const list = groups.map(([h, items]) => `<div class="pcs-group"><h4 class="pcs-lv">${esc(h)}</h4>${items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((s) => spellRow(s, opts.lib, key, opts.open, { atk: sc.atk, abilMod: opts.abilMod || 0 })).join("")}</div>`).join("");
  return `<div class="sc-cast"><p class="sc-feat"><b><i>${sc.innate ? "Innate Spellcasting" : "Spellcasting"}.</i></b> ${intro}</p>${list}</div>`;
}

/* ----- everything structured, in the order a stat block reads ----- */
export function structuredSections(c, opts = {}) {
  const block = (label, html) => (html.trim() ? `<h3 class="sc-h">${label}</h3>${html}` : "");
  const feats = (type) => (c.features || []).filter((f) => f.type === type).map(featureHTML).join("");
  const sa = c.spellcasting?.ability;
  const abilMod = sa ? Math.floor(((Number(c.abilities?.[sa]) || 10) - 10) / 2) : 0;   // for "heals 1d8 + your spellcasting modifier"
  return {
    traits: spellcastingHTML(c.spellcasting, { ...opts, abilMod }) + feats("trait"),
    actions: (c.attacks || []).map(attackHTML).join("") + feats("action"),
    bonus: feats("bonus"),
    reactions: feats("reaction"),
    legendary: feats("legendary"),
    block,
  };
}

/* A short summary for lists: "2 attacks · spellcaster". */
export function statSummary(c) {
  const bits = [];
  if ((c.attacks || []).length) bits.push(`${c.attacks.length} attack${c.attacks.length === 1 ? "" : "s"}`);
  if (c.spellcasting && (c.spellcasting.spells || []).length) bits.push(`${c.spellcasting.spells.length} spell${c.spellcasting.spells.length === 1 ? "" : "s"}`);
  if ((c.features || []).length) bits.push(`${c.features.length} abilit${c.features.length === 1 ? "y" : "ies"}`);
  return bits.join(" · ");
}
