import { esc } from "./common.js";
import { rand, rollExpr, describe } from "./dice.js";

/* Tap-to-roll for NPC and enemy stat cards, the same way a player's sheet does it: tap a number and it rolls, a roll bar shows the
   result, advantage and disadvantage apply to the next d20, and a natural 20 on an attack makes the next damage roll a critical hit.

   The buttons carry everything they need in data attributes, so a card works wherever it is drawn (the library, the combat window,
   a token's Stats). bindCardRolls(container, hooks) makes the cards in `container` live.
   hooks: { post(roll)       share a roll with the table (the DM's roll feed),
            getShare(), setShare(on)   the "players see these rolls" setting (optional) } */

const sgn = (n) => (n >= 0 ? "+" : "−") + Math.abs(n);
const num = (v) => { const n = parseInt(String(v).replace("−", "-").replace(/\s+/g, ""), 10); return Number.isFinite(n) ? n : null; };

/* ----- the buttons ----- */
export const rbtn = (html, attrs, cls = "") => `<button type="button" class="rbtn ${cls}" ${attrs}>${html}</button>`;
export const d20Btn = (html, mod, label, extra = "", cls = "") => rbtn(html, `data-roll="d20" data-mod="${Number(mod) || 0}" data-label="${esc(label)}" ${extra}`, cls);
const rollableDice = (d) => /^\s*\d*d\d+/i.test(String(d || "")) || /^\s*\d+\s*$/.test(String(d || ""));
export const canRollDamage = (parts) => (parts || []).some((p) => rollableDice(p.dice));
export const dmgBtn = (html, parts, label, aid = "", cls = "", extra = "") => rbtn(html, `data-roll="dmg" data-dmg="${esc(JSON.stringify(parts.filter((p) => rollableDice(p.dice)).map((p) => ({ dice: String(p.dice).replace(/\s+/g, "").replace(/−/g, "-"), type: p.type || "" }))))}" data-label="${esc(label)}" ${aid ? `data-aid="${esc(aid)}"` : ""} ${extra}`, cls);
export const critBtn = (parts, label, aid) => dmgBtn("crit", parts, label, aid, "sm crit", 'data-crit="1" title="Roll it as a critical hit: the dice are doubled"');

/* Saving throw bonuses a stat block lists ("Dex +4, Wis +2"), by ability. */
export function parseSaves(text) {
  const out = {};
  for (const m of String(text || "").matchAll(/\b(str|dex|con|int|wis|cha)[a-z]*\.?\s*:?\s*([+\-−]\s*\d+)/gi)) out[m[1].toLowerCase()] = num(m[2]);
  return out;
}

/* A skills line ("Stealth +6, Perception +4") with every skill a button. Anything else in it stays text. */
export function skillsHTML(text) {
  return String(text || "").split(",").map((part) => {
    const m = /^\s*(.+?)\s*([+\-−]\s*\d+)\s*$/.exec(part);
    if (!m) return esc(part.trim());
    const n = num(m[2]);
    return d20Btn(`${esc(m[1])} ${sgn(n)}`, n, `${m[1]} check`);
  }).filter(Boolean).join(" ");
}

/* Free text (traits, actions, anything typed the old way) with "+4 to hit" and "5 (1d6+2) slashing damage" turned into buttons,
   so stat blocks written before the structured boxes existed roll too. */
export function rollifyText(text, fallbackName = "") {
  return String(text ?? "").split("\n").map((line) => {
    const nm = fallbackName || (/^\s*([A-Z][^.:\n]{0,40})[.:]/.exec(line)?.[1] ?? "").trim();
    const name = nm || "Attack";
    let html = esc(line);
    html = html.replace(/([+\-−]\s?\d+)(\s+to hit)/gi, (_, bonus, rest) => d20Btn(`${bonus.replace(/\s+/g, "")}${rest}`, num(bonus), `${name} attack`, `data-aid="t:${esc(name)}"`, "text"));
    html = html.replace(/(\d+)\s*\((\d*d\d+(?:\s*[+\-−]\s*\d+)?)\)(?:(\s+[a-z]+)(\s+damage))?/gi, (all, avg, dice, type, dmg) =>
      dmgBtn(`${avg} (${dice.replace(/\s+/g, "")})`, [{ dice, type: dmg ? type.trim() : "" }], `${name} damage`, `t:${esc(name)}`, "text") + (dmg ? `${type}${dmg}` : ""));
    return html;
  }).join("\n");
}

/* Roll buttons for a spell, worked out from what its description says: a spell attack, damage dice, or healing. */
export function spellRollButtons(entry, name, { atk = null, abilMod = 0 } = {}) {
  const d = String(entry?.desc || "");
  const out = [];
  if (atk != null && /\b(?:ranged|melee) spell attack\b/i.test(d)) out.push(d20Btn(`Attack ${sgn(atk)}`, atk, `${name} attack`, `data-aid="sp:${esc(name)}"`, "sm"));
  const parts = [];
  for (const m of d.matchAll(/(\d+d\d+(?:\s*[+\-−]\s*\d+)?)\s+([a-z]+)\s+damage/gi)) { parts.push({ dice: m[1].replace(/\s+/g, "").replace(/−/g, "-"), type: m[2].toLowerCase() }); if (parts.length >= 3) break; }
  if (parts.length) out.push(dmgBtn(esc(parts.map((p) => `${p.dice} ${p.type}`).join(" + ")), parts, `${name} damage`, `sp:${name}`, "sm"));
  else {
    const h = /(?:regains?|restores?)[^.]{0,120}?(\d+d\d+(?:\s*[+\-−]\s*\d+)?)/i.exec(d);
    if (h) {
      const dice = h[1].replace(/\s+/g, "").replace(/−/g, "-") + (/spellcasting ability modifier/i.test(d) && abilMod ? (abilMod > 0 ? `+${abilMod}` : `${abilMod}`) : "");
      out.push(dmgBtn(`heal ${esc(dice)}`, [{ dice, type: "healing" }], `${name} healing`, "", "sm"));
    }
  }
  return out.join("");
}

/* ----- one card's rolling state: the advantage setting, the last result, and which attacks just rolled a natural 20 ----- */
const states = new Map();
const stateOf = (key) => { if (!states.has(key)) states.set(key, { how: "normal", last: null, crit: new Map() }); return states.get(key); };

/* The roll bar at the top of a card. It is empty here; the page's binder fills it in (and refills it whenever a card is redrawn). */
export const barHTML = (key) => `<div class="rollbar cardbar" data-rollbar data-ck="${esc(key)}" role="status" aria-live="polite"></div>`;

function barInner(s, hasShare, share) {
  const r = s.last;
  const body = r
    ? `<span class="rl">${esc(r.label)}</span><b class="big ${r.nat === 20 ? "crit" : r.nat === 1 ? "fumble" : ""}">${r.total}</b><small>${esc(r.detail)}</small>`
    : '<small class="rhint">Tap a number to roll it.</small>';
  const modes = [["dis", "Disadv."], ["normal", "Normal"], ["adv", "Adv."]].map(([k, l]) => `<button type="button" data-rmode="${k}" aria-pressed="${s.how === k}">${l}</button>`).join("");
  return `<div class="rollres">${body}</div><div class="rollctl"><div class="seg mini rollmode" role="group" aria-label="Roll with">${modes}</div>${hasShare
    ? `<button type="button" class="btn small ghost rshare" data-rshare aria-pressed="${!!share}" title="Whether players see these rolls in the roll feed">Players see: ${share ? "yes" : "no"}</button>` : ""}</div>`;
}

/* ----- the rolling itself ----- */
function d20(modifier, how) {
  const a = rand(20), b = rand(20);
  const pick = how === "adv" ? Math.max(a, b) : how === "dis" ? Math.min(a, b) : a;
  const m = modifier ? (modifier > 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`) : "";
  const dice = how === "normal" ? `d20 [${a}]` : `d20 [${a}, ${b}] take ${how === "adv" ? "higher" : "lower"}`;
  return { total: pick + modifier, nat: pick, detail: dice + m };
}

function rollDamage(parts, crit) {
  let total = 0;
  const bits = [];
  for (const p of parts) {
    let part;
    if (/^\s*\d+\s*$/.test(p.dice)) part = { total: parseInt(p.dice, 10), text: String(parseInt(p.dice, 10)) };   // a flat number
    else {
      const expr = String(p.dice).replace(/(\d*)d(\d+)/gi, (_, n, sides) => `${crit ? 2 * (parseInt(n) || 1) : parseInt(n) || 1}d${sides}`);   // a crit doubles the dice, not the bonus
      const res = rollExpr(expr);
      part = { total: res.total, text: describe(res) };
    }
    total += part.total;
    bits.push(`${p.type && parts.length > 1 || p.type === "healing" ? p.type + ": " : ""}${part.text}`);
  }
  return { total, detail: bits.join(" · ") };
}

const binders = new Set();
export const refreshRollBars = () => binders.forEach((b) => b.paint());

export function bindCardRolls(container, hooks = {}) {
  if (container.__cardRolls) return container.__cardRolls;
  const hasShare = typeof hooks.setShare === "function";
  const sigOf = (key) => JSON.stringify([stateOf(key).how, stateOf(key).last, hasShare ? !!hooks.getShare?.() : null]);

  function paint() {
    for (const el of container.querySelectorAll("[data-rollbar]")) {
      const key = el.dataset.ck, sig = sigOf(key);
      if (el.dataset.sig === sig) continue;   // already showing this
      el.dataset.sig = sig;
      el.innerHTML = barInner(stateOf(key), hasShare, !!hooks.getShare?.());
    }
  }
  new MutationObserver(paint).observe(container, { childList: true, subtree: true });   // a card that is redrawn gets its roll bar back

  function announce(card, info) {
    const s = stateOf(card.dataset.ck);
    s.last = info;
    paint();
    try { hooks.post?.({ as: card.dataset.who || "", label: info.label, total: info.total, detail: info.detail, nat: info.nat === 20 || info.nat === 1 ? info.nat : null }); } catch { /* sharing is best-effort */ }
  }

  container.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-rmode]");
    if (mode) { const key = mode.closest("[data-ck]")?.dataset.ck; if (key) { stateOf(key).how = mode.dataset.rmode; paint(); } return; }
    if (e.target.closest("[data-rshare]")) { hooks.setShare?.(!hooks.getShare?.()); refreshRollBars(); return; }
    const b = e.target.closest("[data-roll]");
    if (!b) return;
    e.preventDefault();   // (a roll button inside a spell's title shouldn't also open the spell)
    const card = b.closest("[data-ck]");
    if (!card) return;
    const s = stateOf(card.dataset.ck), label = b.dataset.label || "Roll", aid = b.dataset.aid || "";
    try {
      if (b.dataset.roll === "d20") {
        const how = s.how, r = d20(Number(b.dataset.mod) || 0, how);
        s.how = "normal";
        if (aid) s.crit.set(aid, r.nat === 20);   // a natural 20 makes the next damage roll for this attack a critical hit
        announce(card, { label: label + (how === "adv" ? " (adv)" : how === "dis" ? " (dis)" : ""), total: r.total, detail: r.detail, nat: r.nat });
      } else if (b.dataset.roll === "dmg") {
        const parts = JSON.parse(b.dataset.dmg || "[]");
        const crit = b.dataset.crit === "1" || (aid && s.crit.get(aid) === true);
        if (aid) s.crit.delete(aid);
        const r = rollDamage(parts, crit);
        announce(card, { label: label + (crit ? " (critical)" : ""), total: r.total, detail: r.detail, nat: null });
      }
    } catch (err) {
      s.last = { label: "Couldn't roll that", total: "—", detail: err.message || "Check the dice.", nat: null };
      paint();
    }
  });

  const api = { paint };
  binders.add(api);
  container.__cardRolls = api;
  paint();
  return api;
}
