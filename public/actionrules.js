/* The rules for using an attack or a spell on one or more targets: what kind of spell it is, how its damage scales, whether an attack
   hits, whether a target makes its saving throw, and how much damage that ends up as.

   Pure functions with no page or server code in them, so the server (which rolls the dice and keeps the record) and the pages (which
   label the buttons) use exactly the same reading of a spell. Dice come from a function you pass in, so tests can choose the rolls. */

export const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_WORDS = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
export const ABIL_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export const modOf = (score) => Math.floor(((Number.isFinite(Number(score)) ? Number(score) : 10) - 10) / 2);
export const profBonus = (level) => 2 + Math.floor((Math.min(20, Math.max(1, Math.round(Number(level)) || 1)) - 1) / 4);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/−/g, "-").trim();
const NUMWORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/* ---------- dice ---------- */
/* "2d6+3", "1d8 + 1d4 - 1", "5" -> { dice: [{ n, sides, sign }], flat }. Null if it isn't a dice formula. */
export function parseDiceExpr(expr) {
  const s = clean(expr).replace(/\s+/g, "");
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== s) return null;
  const dice = [];
  let flat = 0;
  for (const t of terms) {
    const m = /^([+-]?)(\d*)d(\d+)$/i.exec(t);
    if (m) { const n = Number(m[2] || 1), sides = Number(m[3]); if (n < 1 || n > 100 || sides < 2 || sides > 1000) return null; dice.push({ n, sides, sign: m[1] === "-" ? -1 : 1 }); }
    else if (/^[+-]?\d+$/.test(t)) flat += Number(t);
    else return null;
  }
  return { dice, flat };
}

/* Roll a formula. `rng(n)` gives a whole number from 1 to n. A critical hit doubles the dice, never the bonus. */
export function rollDice(expr, rng, { crit = false } = {}) {
  const p = parseDiceExpr(expr);
  if (!p) throw new Error(`"${expr}" isn't a dice formula.`);
  let total = p.flat;
  const bits = [];
  for (const d of p.dice) {
    const n = crit ? d.n * 2 : d.n;
    const rolls = Array.from({ length: n }, () => rng(d.sides));
    const sum = rolls.reduce((a, b) => a + b, 0);
    total += d.sign * sum;
    bits.push(`${d.sign < 0 ? "-" : ""}${n}d${d.sides} [${rolls.join(", ")}]`);
  }
  const detail = bits.join(" + ").replace(/\+ -/g, "- ") + (p.flat ? (p.flat > 0 ? ` + ${p.flat}` : ` - ${Math.abs(p.flat)}`) : "");
  return { total, detail };
}

/* Add dice of the same size to a formula: addDice("8d6", "1d6", 2) is "10d6". */
export function addDice(expr, extra, times = 1) {
  const a = parseDiceExpr(expr), b = parseDiceExpr(extra);
  if (!a || !b || !b.dice.length || times <= 0) return expr;
  const first = a.dice[0];
  const match = b.dice[0];
  if (!first) return expr;
  const parts = clean(expr).replace(/\s+/g, "");
  if (first.sides !== match.sides) return `${parts}+${match.n * times}d${match.sides}`;
  return parts.replace(/^([+-]?)(\d*)d(\d+)/i, (_, sg, n, sides) => `${sg}${(Number(n || 1) + match.n * times)}d${sides}`);
}

/* The first formula and damage type in a piece of free text ("1d8+3 piercing", "2d6 fire plus 1d4 poison"). */
export function parseDamageText(text) {
  const out = [];
  const t = clean(text);
  const re = /(\d*d\d+(?:\s*[+-]\s*(?:\d*d\d+|\d+))*)(?:\s*\(?([a-z]+)\)?)?/gi;
  for (const m of t.matchAll(re)) {
    const dice = m[1].replace(/\s+/g, "");
    if (!parseDiceExpr(dice)) continue;
    const word = (m[2] || "").toLowerCase();
    out.push({ dice, type: ["plus", "and", "damage", "or", "of", "to"].includes(word) ? "" : word });
    if (out.length >= 4) break;
  }
  return out;
}

export const parseAc = (text) => { const m = /\d+/.exec(String(text ?? "")); return m ? Number(m[0]) : null; };
export const parseBonus = (text) => { const m = /[+-]?\s*\d+/.exec(String(text ?? "").replace(/−/g, "-")); return m ? Number(m[0].replace(/\s+/g, "")) : null; };

/* "Dex +4, Wis +2" -> { dex: 4, wis: 2 } */
export function parseSaveList(text) {
  const out = {};
  for (const m of String(text || "").matchAll(/\b(str|dex|con|int|wis|cha)[a-z]*\.?\s*:?\s*([+\-−]\s*\d+)/gi)) out[m[1].toLowerCase()] = Number(m[2].replace(/[\s−]/g, (c) => (c === "−" ? "-" : "")));
  return out;
}

/* Spells whose damage depends on a choice or on a later event, so only the main effect is rolled. */
const SPELL_FIXES = {
  "spirit guardians": { damage: [{ dice: "3d8", type: "radiant" }] },   // radiant or necrotic, by who you are
  "web": { damage: [] },                                                // fire damage only if the web is lit
};

/* ---------- what a spell does, read from its description ---------- */
export function classifySpell(entry) {
  const full = clean(entry?.desc);
  const higher = full.search(/at higher levels\./i);
  const main = higher >= 0 ? full.slice(0, higher) : full;
  const hi = higher >= 0 ? full.slice(higher) : "";
  const level = Number(entry?.level) || 0;
  const p = { kind: "other", ability: null, damage: [], half: false, heal: null, projectiles: null, slotScale: null, cantripScale: false, effect: "" };

  const abilityWords = "strength|dexterity|constitution|intelligence|wisdom|charisma";
  const saveM = new RegExp(`(?:make|makes|succeed on|succeeds on|succeed at|fail|fails)\\s+(?:an?\\s+)?(${abilityWords})\\s+saving throws?`, "i").exec(main);
  if (saveM) p.ability = ABIL_WORDS[saveM[1].toLowerCase()];

  for (const m of main.matchAll(/(\d+d\d+(?:\s*[+-]\s*\d+)?)(?:\s+([a-z]+))?\s+damage/gi)) {
    p.damage.push({ dice: m[1].replace(/\s+/g, ""), type: (m[2] || "").toLowerCase() });
    if (p.damage.length >= 3) break;
  }
  p.damage = p.damage.filter((d, i, a) => a.findIndex((x) => x.dice === d.dice && x.type === d.type) === i);   // (Witch Bolt prints its damage twice)
  p.half = /half as much damage|half damage|half as much/i.test(main);

  const healM = /(?:regains?|restores?)[^.]{0,140}?(\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(main);
  const flatHeal = /regains?\s+(\d+)\s+hit points/i.exec(main);
  if (healM) p.heal = { dice: healM[1].replace(/\s+/g, ""), addMod: /spellcasting ability modifier/i.test(main) };
  else if (flatHeal) p.heal = { dice: flatHeal[1], addMod: false };

  const attackM = /\b(ranged|melee) spell attack\b/i.exec(main);
  if (attackM) { p.kind = "attack"; p.melee = attackM[1].toLowerCase() === "melee"; }
  else if (p.ability) p.kind = "save";
  else if (p.heal && !p.damage.length) p.kind = "heal";
  else if (p.damage.length) p.kind = "auto";

  // several darts, rays or beams
  const proj = /creates?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:glowing\s+)?(darts|rays|beams|missiles|bolts)/i.exec(main);
  const per = /(one|two|a|an)\s+(?:more|additional)\s+(?:dart|ray|beam|missile|bolt)s?\s+for each slot level above\s+(\d)/i.exec(hi);
  if (proj) p.projectiles = { base: NUMWORD[proj[1].toLowerCase()] || 1, perSlot: per ? NUMWORD[per[1].toLowerCase()] : 0, above: per ? Number(per[2]) : level };
  else if (/two beams at 5th level, three beams at 11th level, and four beams at 17th level/i.test(main)) p.projectiles = { base: 1, byLevel: [[5, 2], [11, 3], [17, 4]] };

  const scale = /(?:damage|healing)\s+increases by\s+(\d+d\d+)\s+for each slot level above\s+(\d)/i.exec(hi);
  if (scale) p.slotScale = { dice: scale[1], above: Number(scale[2]) };
  p.cantripScale = level === 0 && /when you reach 5th level/i.test(main);

  const fix = SPELL_FIXES[String(entry?.name || "").toLowerCase()];   // a few spells whose text can't be read as a single effect
  if (fix) Object.assign(p, fix);
  if (!p.damage.length && p.kind === "save") {
    const sentence = main.split(/(?<=[.!?])\s+/).find((x) => /saving throw/i.test(x)) || "";
    p.effect = sentence.slice(0, 200);
  }
  return p;
}

/* The spell as it will be cast: its damage or healing at this slot level and caster level, and how many darts or rays. */
export function scaleSpell(profile, { level = 0, slot = null, casterLevel = 1 } = {}) {
  const cl = Math.max(1, Math.round(Number(casterLevel)) || 1);
  const tiers = 1 + (cl >= 5) + (cl >= 11) + (cl >= 17);
  const slotLevel = slot == null ? level : Math.max(level, Number(slot) || level);
  const above = (a) => Math.max(0, slotLevel - (a ?? level));
  const damage = profile.damage.map((d) => ({ ...d }));
  if (damage.length && profile.cantripScale) damage[0].dice = damage[0].dice.replace(/^(\d*)d(\d+)/i, (_, n, s) => `${(Number(n || 1)) * tiers}d${s}`);
  if (damage.length && profile.slotScale && above(profile.slotScale.above)) damage[0].dice = addDice(damage[0].dice, profile.slotScale.dice, above(profile.slotScale.above));
  let heal = profile.heal ? { ...profile.heal } : null;
  if (heal && profile.slotScale && above(profile.slotScale.above)) heal.dice = addDice(heal.dice, profile.slotScale.dice, above(profile.slotScale.above));
  let shots = 1;
  const pr = profile.projectiles;
  if (pr) {
    shots = pr.base;
    if (pr.byLevel) for (const [lv, n] of pr.byLevel) if (cl >= lv) shots = n;
    if (pr.perSlot) shots += pr.perSlot * above(pr.above);
  }
  return { damage, heal, shots };
}

/* ---------- a character's numbers, worked out from their sheet ---------- */
export function pcFromSheet(sheet) {
  const c = sheet?.char || {};
  const ab = c.abilities || {};
  const level = Math.min(20, Math.max(1, Number(c.info?.level) || 1));
  const prof = profBonus(level);
  const save = {};
  for (const k of ABIL) save[k] = modOf(ab[k]) + (c.saves?.[k] ? prof : 0);
  const cast = ABIL.includes(c.cast) ? c.cast : "";
  return { level, prof, ac: Number.isFinite(Number(c.combat?.ac)) && c.combat?.ac !== "" ? Number(c.combat.ac) : null, save,
    cast, spellMod: cast ? modOf(ab[cast]) : 0, spellDC: cast ? 8 + prof + modOf(ab[cast]) : null, spellAtk: cast ? prof + modOf(ab[cast]) : null };
}

/* ---------- using an action on targets ---------- */
function d20(rng, mode) {
  const a = rng(20);
  if (mode !== "adv" && mode !== "dis") return { nat: a, dice: `d20 [${a}]` };
  const b = rng(20);   // (a second die only with advantage or disadvantage)
  return { nat: mode === "adv" ? Math.max(a, b) : Math.min(a, b), dice: `d20 [${a}, ${b}] take ${mode === "adv" ? "higher" : "lower"}` };
}
const withBonus = (r, bonus) => ({ total: r.nat + bonus, nat: r.nat, detail: r.dice + (bonus ? (bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`) : "") });

/* The result of using something.
     actor:   { id, name }
     action:  an attack      { type: "attack", name, bonus, damage: [{ dice, type }], save?: { ability, dc, onSave }, noRoll? }
              a spell        { type: "spell", name, level, profile, dc, atk, spellMod }   (profile from classifySpell)
     targets: [{ id, name, ac, save: { str..cha: bonus } }]
     opts:    { rng, mode, slot, casterLevel }
   Returns { type, name, slot, shots, targets, dc, ability, notes } where every target ends with what it takes or regains. */
export function resolveAction({ actor, action, targets, rng, mode = "normal", slot = null, casterLevel = 1 }) {
  const out = { type: "other", name: action.name, actor: { id: actor.id, name: actor.name }, mode, slot, shots: [], targets: [], dc: null, ability: null, notes: [] };
  const tmap = new Map(targets.map((t) => [t.id, { id: t.id, name: t.name, ac: t.ac ?? null, outcome: "none", dealt: 0, healed: 0, save: null, hits: 0, shots: 0 }]));
  out.targets = [...tmap.values()];
  const list = out.targets;
  const utility = action.type === "spell" && action.profile?.kind === "other";   // Shield, Bless: nothing to roll, so no target is needed
  if (!list.length && !utility) { out.notes.push("No targets were chosen."); return out; }

  // ----- an attack from a stat block or a character sheet
  if (action.type === "attack") {
    const a = action;
    const hasRoll = !a.noRoll && Number.isFinite(a.bonus);
    if (a.save && a.save.ability && !hasRoll) {   // a breath weapon: no attack roll, the target saves
      return resolveSave({ out, list, targets, rng, dc: a.save.dc, ability: a.save.ability, damage: a.damage, half: /half/i.test(a.save.onSave || ""), actor, mode });
    }
    out.type = "attack";
    for (const t of targets) {
      const tr = tmap.get(t.id), roll = withBonus(d20(rng, mode), hasRoll ? a.bonus : 0);
      const hit = roll.nat === 20 || (roll.nat !== 1 && t.ac != null && roll.total >= t.ac);
      const unknown = t.ac == null && roll.nat !== 20 && roll.nat !== 1;
      const outcome = !hasRoll ? "none" : roll.nat === 20 ? "crit" : roll.nat === 1 ? "miss" : unknown ? "unknown" : hit ? "hit" : "miss";
      const shot = { target: t.id, roll, outcome, damage: null };
      if (outcome === "hit" || outcome === "crit" || outcome === "unknown" || !hasRoll) {
        const parts = (a.damage || []).filter((d) => parseDiceExpr(d.dice)).map((d) => ({ type: d.type, ...rollDice(d.dice, rng, { crit: outcome === "crit" }) }));
        if (parts.length) shot.damage = { total: parts.reduce((s, p) => s + p.total, 0), detail: parts.map((p) => `${p.type ? p.type + ": " : ""}${p.detail}`).join(" · "), parts };
      }
      out.shots.push(shot);
      tr.shots++; tr.outcome = shot.outcome;
      if (shot.outcome === "hit" || shot.outcome === "crit") tr.hits++;
      if (shot.damage && shot.outcome !== "unknown") tr.dealt += shot.damage.total;
      if (a.save && a.save.ability && (shot.outcome === "hit" || shot.outcome === "crit")) {   // an attack that also forces a save (a poisoned sting)
        const sv = withBonus(d20(rng, "normal"), t.save?.[a.save.ability] ?? 0);
        tr.save = { ability: a.save.ability, dc: a.save.dc, ...sv, success: sv.total >= a.save.dc };
      }
    }
    return out;
  }

  // ----- a spell
  const prof = action.profile;
  const sc = scaleSpell(prof, { level: action.level, slot, casterLevel });
  out.dc = action.dc ?? null;
  out.ability = prof.ability;

  if (prof.kind === "save") {
    return resolveSave({ out, list, targets, rng, dc: action.dc, ability: prof.ability, damage: sc.damage, half: prof.half, actor, mode, effect: prof.effect });
  }
  if (prof.kind === "attack") {
    out.type = "attack";
    const atk = action.atk;
    const shotsN = Math.max(1, sc.shots);
    for (let i = 0; i < shotsN; i++) {
      const t = targets[i % targets.length], tr = tmap.get(t.id);
      const roll = withBonus(d20(rng, mode), Number.isFinite(atk) ? atk : 0);
      const outcome = roll.nat === 20 ? "crit" : roll.nat === 1 ? "miss" : t.ac == null ? "unknown" : roll.total >= t.ac ? "hit" : "miss";
      const shot = { target: t.id, roll, outcome, damage: null };
      if (outcome !== "miss") {
        const parts = sc.damage.map((d) => ({ type: d.type, ...rollDice(d.dice, rng, { crit: outcome === "crit" }) }));
        if (parts.length) shot.damage = { total: parts.reduce((s, p) => s + p.total, 0), detail: parts.map((p) => `${p.type ? p.type + ": " : ""}${p.detail}`).join(" · "), parts };
      }
      out.shots.push(shot);
      tr.shots++; tr.outcome = shot.outcome;
      if (shot.outcome === "hit" || shot.outcome === "crit") tr.hits++;
      if (shot.damage && shot.outcome !== "unknown") tr.dealt += shot.damage.total;
    }
    if (!Number.isFinite(atk)) out.notes.push("This character has no spell attack bonus yet: choose a spellcasting ability on the sheet.");
    return out;
  }
  if (prof.kind === "auto") {   // Magic Missile: it can't miss
    out.type = "auto";
    const shotsN = Math.max(1, sc.shots);
    for (let i = 0; i < shotsN; i++) {
      const t = targets[i % targets.length], tr = tmap.get(t.id);
      const parts = sc.damage.map((d) => ({ type: d.type, ...rollDice(d.dice, rng) }));
      const dmg = { total: parts.reduce((s, p) => s + p.total, 0), detail: parts.map((p) => `${p.type ? p.type + ": " : ""}${p.detail}`).join(" · "), parts };
      out.shots.push({ target: t.id, roll: null, outcome: "auto", damage: dmg });
      tr.dealt += dmg.total; tr.shots++; tr.hits++; tr.outcome = "auto";
    }
    return out;
  }
  if (prof.kind === "heal" && sc.heal) {
    out.type = "heal";
    const bonus = sc.heal.addMod ? (action.spellMod || 0) : 0;
    const expr = /d/i.test(sc.heal.dice) ? `${sc.heal.dice}${bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : ""}` : String(Number(sc.heal.dice) + bonus);
    const r = /d/i.test(expr) ? rollDice(expr, rng) : { total: Number(expr), detail: String(expr) };
    const amount = Math.max(0, r.total);
    for (const t of targets) { const tr = tmap.get(t.id); tr.healed = amount; tr.outcome = "heal"; }
    out.heal = { total: amount, detail: r.detail };
    return out;
  }
  out.notes.push("This spell has no dice to roll here. Its effect is in the description.");
  return out;
}

/* One damage roll for everyone; each target makes its own saving throw. */
function resolveSave({ out, list, targets, rng, dc, ability, damage, half, actor, mode, effect }) {
  out.type = "save";
  out.dc = dc ?? null;
  out.ability = ability;
  const parts = (damage || []).filter((d) => parseDiceExpr(d.dice)).map((d) => ({ type: d.type, ...rollDice(d.dice, rng) }));
  const dmg = parts.length ? { total: parts.reduce((s, p) => s + p.total, 0), detail: parts.map((p) => `${p.type ? p.type + ": " : ""}${p.detail}`).join(" · "), parts } : null;
  out.damageRoll = dmg;
  if (!Number.isFinite(dc)) out.notes.push("There's no save DC for this. Set the spellcasting ability (or the DC on the stat block).");
  for (const t of targets) {
    const tr = list.find((x) => x.id === t.id);
    const sv = withBonus(d20(rng, "normal"), t.save?.[ability] ?? 0);
    const success = Number.isFinite(dc) ? sv.total >= dc : null;
    tr.save = { ability, dc, ...sv, success };
    tr.outcome = success == null ? "unknown" : success ? "saved" : "failed";
    tr.shots = 1;
    if (dmg) tr.dealt = success ? (half ? Math.floor(dmg.total / 2) : 0) : dmg.total;
    out.shots.push({ target: t.id, roll: sv, outcome: tr.outcome, damage: null });
  }
  if (effect && !dmg) out.notes.push(effect);
  return out;
}

/* A short sentence for the roll feed and for players, who don't see enemy armor class. */
export function summarize(res, { forPlayers = false } = {}) {
  const names = res.targets.map((t) => t.name).join(", ") || "no one";
  if (res.type === "save") return `${res.actor.name} uses ${res.name} on ${names}: ` + res.targets.map((t) => `${t.name} ${t.outcome === "saved" ? "saves" : t.outcome === "failed" ? "fails" : "rolls"} (${t.save?.total})`).join(", ");
  if (res.type === "heal") return `${res.actor.name} casts ${res.name} on ${names}: heals ${res.heal?.total ?? 0}`;
  if (res.type === "attack" || res.type === "auto") return `${res.actor.name} uses ${res.name} on ${names}: ` + res.shots.map((s) => {
    const t = res.targets.find((x) => x.id === s.target);
    return `${s.roll ? s.roll.total + " " : ""}${s.outcome === "crit" ? "critical hit" : s.outcome === "auto" ? "hits" : s.outcome}${s.damage ? ` (${s.damage.total})` : ""} on ${t?.name || "?"}`;
  }).join(", ");
  return `${res.actor.name} uses ${res.name}.`;
}
