import { esc } from "./common.js";
import { classifySpell, scaleSpell, ABIL_NAMES } from "./actionrules.js";

/* Using an attack or a spell on targets: pick the spell slot, how to roll, and who it is aimed at, then everything is rolled by the
   server and the result is shown here. Used by the player page and by the DM page, for creatures too. */

const ORD = ["", "1st", "2nd", "3rd"];
export const ord = (n) => ORD[n] || `${n}th`;
const TYPE_ORDER = { pc: 0, npc: 1, enemy: 2, object: 3 };
const TYPE_LABEL = { pc: "Players", npc: "NPCs", enemy: "Enemies", object: "Objects" };
const DOT = { pc: "var(--pc)", npc: "var(--npc)", enemy: "var(--enemy)", object: "#8a8f9c" };

/* Squares between two tokens, or null if the map has no grid. */
export function squaresBetween(a, b, g) {
  if (!g || !g.on || !(Number(g.size) > 0) || !g.mapW) return null;
  return Math.hypot((a.x - b.x) * g.mapW, (a.y - b.y) * (g.mapH || g.mapW)) / g.size;
}

/* A sentence about what this will do, at this slot level. */
function describe(o, slot) {
  if (o.kind === "attack") {
    const a = o.attack || {};
    return [a.bonus != null ? `Attack roll ${a.bonus >= 0 ? "+" : "−"}${Math.abs(a.bonus)}` : "", a.damageText || ""].filter(Boolean).join(" · ") || "No attack roll or damage written for this one.";
  }
  const sp = o.spell || {};
  const entry = sp.entry;
  if (!entry) return "This spell isn't in the spell library, so there are no dice to roll here. Casting it spends the slot.";
  const p = classifySpell(entry);
  const sc = scaleSpell(p, { level: sp.level, slot, casterLevel: o.casterLevel || 1 });
  const dmg = sc.damage.map((d) => `${d.dice} ${d.type}`.trim()).join(" + ");
  const dc = o.dc != null ? ` (DC ${o.dc})` : "";
  if (p.kind === "attack") return `Spell attack${o.atk != null ? ` ${o.atk >= 0 ? "+" : "−"}${Math.abs(o.atk)}` : ""} · ${dmg || "no damage"}${sc.shots > 1 ? ` · ${sc.shots} ${/ray/.test(entry.desc) ? "rays" : /beam/.test(entry.desc) ? "beams" : "attacks"}` : ""}`;
  if (p.kind === "save") return `${ABIL_NAMES[p.ability]} save${dc}${dmg ? ` · ${dmg}${p.half ? ", half on a save" : ", nothing on a save"}` : ` · ${p.effect ? "an effect, not damage" : "no damage"}`}`;
  if (p.kind === "auto") return `${sc.shots} dart${sc.shots === 1 ? "" : "s"}, ${dmg} each · can't miss`;
  if (p.kind === "heal") return `Heals ${sc.heal.dice}${sc.heal.addMod && o.spellMod ? ` ${o.spellMod >= 0 ? "+" : "−"} ${Math.abs(o.spellMod)}` : ""}`;
  return "No dice to roll here. Its effect is in the description. Casting it spends the slot.";
}

const kindClass = (outcome) => (outcome === "hit" || outcome === "crit" || outcome === "saved" || outcome === "heal" || outcome === "auto" ? "ok" : outcome === "miss" || outcome === "failed" ? "bad" : "");

/* What happened, as lines to read. `dm` also shows armor classes. */
export function resultHTML(res, { dm = false } = {}) {
  const t = (id) => res.targets.find((x) => x.id === id);
  const lines = [];
  if (res.type === "save") {
    for (const x of res.targets) {
      const verdict = x.outcome === "saved" ? "saves" : x.outcome === "failed" ? "fails" : "rolls";
      lines.push(`<li><b>${esc(x.name)}</b>: ${esc(ABIL_NAMES[x.save.ability] || "")} save <b class="num ${kindClass(x.outcome)}">${x.save.total}</b> against DC ${x.save.dc ?? "?"}, <span class="${kindClass(x.outcome)}">${verdict}</span>${x.dealt ? ` and takes <b>${x.dealt}</b>` : ""}</li>`);
    }
    if (res.damageRoll) lines.push(`<li class="hint">Damage rolled: ${esc(res.damageRoll.detail)} = ${res.damageRoll.total}</li>`);
  } else if (res.type === "attack" || res.type === "auto") {
    for (const s of res.shots) {
      const x = t(s.target);
      const word = s.outcome === "crit" ? "Critical hit!" : s.outcome === "hit" ? "Hit" : s.outcome === "miss" ? "Miss" : s.outcome === "auto" ? "Hits" : "Rolled";
      const ac = dm && x?.ac != null && s.roll ? ` against AC ${x.ac}` : "";
      lines.push(`<li><b>${esc(x?.name || "?")}</b>: ${s.roll ? `<b class="num ${kindClass(s.outcome)}">${s.roll.total}</b>${ac}, ` : ""}<span class="${kindClass(s.outcome)}">${word}</span>${s.damage ? ` for <b>${s.damage.total}</b> <small>(${esc(s.damage.detail)})</small>` : ""}${s.outcome === "unknown" ? ' <small class="hint">(armor class not known: the DM decides)</small>' : ""}</li>`);
    }
    for (const x of res.targets) if (x.save) lines.push(`<li><b>${esc(x.name)}</b> also saves: ${esc(ABIL_NAMES[x.save.ability] || "")} <b class="num ${x.save.success ? "ok" : "bad"}">${x.save.total}</b> against DC ${x.save.dc}, <span class="${x.save.success ? "ok" : "bad"}">${x.save.success ? "saves" : "fails"}</span></li>`);
  } else if (res.type === "heal") {
    lines.push(`<li>${res.targets.map((x) => `<b>${esc(x.name)}</b>`).join(", ")} regain${res.targets.length === 1 ? "s" : ""} <b class="num ok">${res.heal?.total ?? 0}</b> hit points <small>(${esc(res.heal?.detail || "")})</small></li>`);
  }
  const notes = (res.notes || []).map((n) => `<p class="hint">${esc(n)}</p>`).join("");
  const slot = res.slot ? `<p class="hint">Used a ${ord(res.slot)}-level slot${res.slotLeft != null ? `: ${res.slotLeft} left` : ""}.</p>` : "";
  return `<ul class="actres">${lines.join("")}</ul>${notes}${slot}`;
}

/* Open the dialog.
   o: { doc, actor: {id, name}, kind: "attack" | "spell", ref, label,
        spell: { name, level, entry }, attack: { bonus, damageText }, slots: { level: { max, used } }, casterLevel, dc, atk, spellMod,
        tokens: [{ id, name, type, hp, maxHp, x, y }], grid: { on, size, mapW, mapH }, dm,
        share: { get(), set(on) },
        send(body) -> Promise<{ id, result }>, apply?(id) -> Promise, onResult?(res) } */
export function openActionDialog(o) {
  const doc = o.doc || document;
  let dlg = doc.querySelector("dialog.actdlg");
  if (!dlg) { dlg = doc.createElement("dialog"); dlg.className = "actdlg"; doc.body.appendChild(dlg); }
  const me = o.tokens.find((t) => t.id === o.actor.id);
  const leveled = !o.noSlots && o.kind === "spell" && (o.spell?.level || 0) > 0;   // (creatures don't track slots)
  const slotChoices = leveled ? Object.keys(o.slots || {}).map(Number).filter((l) => l >= o.spell.level && o.slots[l].max > o.slots[l].used).sort((a, b) => a - b) : [];
  const spellKind = o.kind === "spell" ? (o.spell?.entry ? classifySpell(o.spell.entry).kind : "other") : "attack";
  const needsTarget = spellKind !== "other";   // a spell with nothing to roll (Shield, Bless) can be cast with no target
  const attackish = o.kind === "attack" ? o.attack?.bonus != null : spellKind === "attack";   // (a breath weapon has no attack roll to take advantage on)
  let mode = "normal", slot = slotChoices[0] ?? null;

  const groups = [...new Set(o.tokens.map((t) => t.type))].sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9));
  const dist = (t) => { const d = me ? squaresBetween(me, t, o.grid) : null; return d == null ? "" : t.id === o.actor.id ? "you" : `${Math.round(d)} sq`; };
  const targetRows = groups.map((g) => `<fieldset class="actgrp"><legend>${TYPE_LABEL[g] || g}</legend>${o.tokens.filter((t) => t.type === g).map((t) => `
      <label class="acttgt"><input type="checkbox" value="${esc(t.id)}"><span class="dot" style="background:${DOT[t.type] || "#999"}"></span><b>${esc(t.name)}${t.id === o.actor.id ? " (you)" : ""}</b>
        <small>${[o.dm && t.hp != null ? `HP ${t.hp}${t.maxHp != null ? "/" + t.maxHp : ""}` : "", dist(t)].filter(Boolean).join(" · ")}</small></label>`).join("")}</fieldset>`).join("");

  const draw = () => {
    dlg.querySelector("[data-desc]").textContent = describe(o, slot);
    const blocked = leveled && !slotChoices.length;
    dlg.querySelector("[data-go]").disabled = blocked;
    dlg.querySelector("[data-warn]").textContent = blocked ? `No spell slots of level ${o.spell.level} or higher are left.` : "";
    dlg.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  };

  dlg.innerHTML = `<form method="dialog" class="actform">
    <h2>${esc(o.label)}</h2>
    <p class="hint" data-desc style="margin:.1rem 0 .6rem"></p>
    ${leveled ? `<label class="cf"><span>Spell slot</span><select data-slot>${slotChoices.map((l) => `<option value="${l}">${ord(l)} level (${o.slots[l].max - o.slots[l].used} left)${l > o.spell.level ? ", a stronger cast" : ""}</option>`).join("") || "<option>none left</option>"}</select></label>` : ""}
    ${attackish ? `<div class="seg mini" role="group" aria-label="Roll with" style="margin:.2rem 0 .5rem">${[["dis", "Disadv."], ["normal", "Normal"], ["adv", "Adv."]].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${k === "normal"}">${l}</button>`).join("")}</div>` : ""}
    <div class="acttargets" data-targets><p class="hint" style="margin:.2rem 0">Choose who it is aimed at. You can pick more than one.</p>${targetRows || '<p class="empty">There is nothing on the map to aim at.</p>'}</div>
    ${o.dm && o.share ? `<label class="check" style="margin-top:.5rem"><input type="checkbox" data-share ${o.share.get() ? "checked" : ""}> Players see these rolls</label>` : ""}
    <p class="msg bad" data-warn role="alert"></p>
    <div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-go>${o.kind === "attack" ? "Attack" : "Cast"}</button></div>
  </form>`;
  draw();

  const chosen = () => [...dlg.querySelectorAll("[data-targets] input:checked")].map((i) => i.value);
  dlg.querySelector("[data-cancel]").onclick = () => dlg.close();
  dlg.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => { mode = b.dataset.mode; draw(); }; });
  dlg.querySelector("[data-slot]")?.addEventListener("change", (e) => { slot = Number(e.target.value); draw(); });
  dlg.querySelector("[data-share]")?.addEventListener("change", (e) => o.share.set(e.target.checked));

  dlg.querySelector("[data-go]").onclick = async () => {
    const go = dlg.querySelector("[data-go]");
    const targets = chosen();
    if (!targets.length && needsTarget) { dlg.querySelector("[data-warn]").textContent = "Choose at least one target."; return; }
    go.disabled = true;
    dlg.querySelector("[data-warn]").textContent = "";
    try {
      const out = await o.send({ kind: o.kind, ref: o.ref, targets, mode: attackish ? mode : "normal", slot: leveled ? slot : undefined, visible: o.dm ? !!o.share?.get() : undefined });
      const res = out.result;
      dlg.innerHTML = `<div class="actform"><h2>${esc(res.name)}</h2>${resultHTML(res, { dm: o.dm })}
        <div class="dlg-actions">${o.dm && o.apply && res.targets.some((x) => x.dealt || x.healed) ? '<button type="button" class="btn" data-apply>Apply to hit points</button>' : ""}<button type="button" class="btn primary" data-done>Done</button></div></div>`;
      dlg.querySelector("[data-done]").onclick = () => dlg.close();
      const ap = dlg.querySelector("[data-apply]");
      if (ap) ap.onclick = async () => { ap.disabled = true; try { await o.apply(out.id); ap.textContent = "Applied"; } catch { ap.disabled = false; } };
      o.onResult?.(res, out);
    } catch (err) {
      go.disabled = false;
      dlg.querySelector("[data-warn]").textContent = err.message || "That didn't work. Try again.";
    }
  };
  if (!dlg.open) dlg.showModal();
}
