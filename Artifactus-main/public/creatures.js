import { call, esc, uid } from "./common.js";
import { mod } from "./charsheet.js";
import { d20Btn, barHTML, skillsHTML, parseSaves, rollifyText, bindCardRolls } from "./creaturerolls.js";
import { sg, ord, crValue, profByCr, diceAvg, ATTACK_KINDS, FEATURE_TYPES, ABIL_NAMES, normalizeStats, blankAttack, blankFeature, blankSpell, blankSpellcasting, structuredSections, statSummary, bindOpenState } from "./statblock.js";
export { crValue };

/* The DM's library of NPCs and enemies: stat blocks kept for the whole campaign, separate from any one session.
   mountCreatures(root, opts) draws the tab into `root` and returns a small API for the rest of the page.
   opts: { room, pin, toast(msg), addToMap(spec), showTab() } */

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const STATUS = { saved: "Saved", saving: "Saving…", error: "Couldn't save. Trying again…" };

export const blankCreature = (type = "enemy") => ({
  id: uid(), type, name: "", kind: "", tags: "", role: "", ac: "", hp: 0, hpNote: "", speed: "30 ft.",
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saves: "", skills: "", resist: "", senses: "", languages: "", cr: "",
  traits: "", actions: "", extra: "", wants: "", secret: "", voice: "", notes: "", count: 1, updated: Date.now(),
  attacks: [], features: [], spellcasting: null,
});

/* A stat block laid out for reading at the table.
   opts: { title, lib: (name) -> spell details, open: Map of open sections, key: id for the open-state keys, openByDefault: [names] } */
export function cardHTML(c0, { title = true, lib = null, open = null, key = "", openByDefault = [], who = "" } = {}) {
  const c = normalizeStats({ ...c0 });
  const rk = key || `card:${c.id}`;   // also names this card's roll bar
  const saves = parseSaves(c.saves);
  const line = (label, v) => (String(v ?? "").trim() ? `<p class="sc-line"><b>${label}</b> ${esc(String(v))}</p>` : "");
  const block = (label, text, rolls = false) => (String(text ?? "").trim() ? `<h3 class="sc-h">${label}</h3><div class="sc-text">${rolls ? rollifyText(text) : esc(text)}</div>` : "");
  const npc = c.type === "npc";
  const sub = [c.kind, npc ? c.role : ""].filter((x) => String(x).trim()).join(" · ");
  const story = npc && [c.wants, c.secret, c.voice].some((x) => String(x).trim())
    ? `<hr>${block("Wants", c.wants)}${block("Secret", c.secret)}${block("Voice and manner", c.voice)}` : "";
  const S = structuredSections(c, { lib, open, key: rk });
  const free = (t) => (String(t ?? "").trim() ? `<div class="sc-text">${rollifyText(t)}</div>` : "");
  const dexMod = mod(c.abilities.dex);
  const sect = (label, structured, text) => (structured.trim() || String(text ?? "").trim() ? `<h3 class="sc-h">${label}</h3>${structured}${free(text)}` : "");
  return `<article class="statcard ${npc ? "npc" : "enemy"}" data-ck="${esc(rk)}" data-who="${esc(who || c.name || "")}">
    ${title ? `<h2>${esc(c.name || "Unnamed")}</h2>` : ""}
    ${sub ? `<p class="sc-sub">${esc(sub)}</p>` : ""}
    ${barHTML(rk)}
    <hr>
    ${line("Armor Class", c.ac)}${line("Hit Points", c.hp ? `${c.hp}${String(c.hpNote).trim() ? ` (${c.hpNote})` : ""}` : "")}${line("Speed", c.speed)}
    <p class="sc-line"><b>Initiative</b> ${d20Btn(sg(dexMod), dexMod, "Initiative", "", "text")}</p>
    <hr>
    <div class="sc-abil">${ABIL.map((k) => {
      const m = mod(c.abilities[k]), sv = saves[k] ?? m;   // a save the stat block lists, or just the ability modifier
      return `<div><b>${k.toUpperCase()}</b>${d20Btn(`${c.abilities[k]} (${sg(m)})`, m, `${ABIL_NAMES[k]} check`, "", "abil")}${d20Btn(`save ${sg(sv)}`, sv, `${ABIL_NAMES[k]} save`, "", `sm${saves[k] != null ? " prof" : ""}`)}</div>`;
    }).join("")}</div>
    <hr>
    ${line("Saving Throws", c.saves)}${String(c.skills ?? "").trim() ? `<p class="sc-line"><b>Skills</b> ${skillsHTML(c.skills)}</p>` : ""}${line("Damage Resistances and Immunities", c.resist)}${line("Senses", c.senses)}${line("Languages", c.languages)}${line("Challenge", c.cr)}
    ${sect("Traits", S.traits, c.traits)}${sect("Actions", S.actions, c.actions)}${sect("Bonus Actions", S.bonus, "")}${sect("Reactions", S.reactions, "")}${sect("Legendary Actions", S.legendary, "")}${block("Bonus actions, reactions and legendary actions", c.extra, true)}
    ${story}
    ${block(npc ? "Notes" : "Tactics and notes", c.notes)}
  </article>`;
}

export function mountCreatures(root, { room, pin, toast, addToMap, showTab, spellLib = null, rolls = {} }) {
  const spellFind = (n) => (spellLib ? spellLib.find(n) : null);
  const cardOpen = new Map();   // which spell lists are open on the stat card
  let doc = null, selId = "", filter = "all", query = "", sort = "name";
  let status = "saved", saving = false, dirty = false, timer = null, loadPromise = null, loadError = "";

  root.innerHTML = `
    <div class="crea">
      <header class="camphead">
        <div class="seg mini" role="group" aria-label="Show">
          <button type="button" data-filter="all" aria-pressed="true">All</button>
          <button type="button" data-filter="npc" aria-pressed="false">NPCs</button>
          <button type="button" data-filter="enemy" aria-pressed="false">Enemies</button>
        </div>
        <input type="search" class="creasearch" data-q placeholder="Search name or tags" aria-label="Search the library">
        <select data-sort aria-label="Sort by" style="width:auto;min-height:36px">
          <option value="name">A to Z</option><option value="cr">Challenge</option><option value="recent">Recently edited</option>
        </select>
        <span class="grow"></span>
        <span class="sync" data-status>Saved</span>
        <button class="btn small primary" type="button" data-act="new-npc">New NPC</button>
        <button class="btn small primary" type="button" data-act="new-enemy">New enemy</button>
      </header>
      <div class="creabody">
        <aside class="crealist" data-list aria-label="NPCs and enemies"></aside>
        <section class="creaedit" data-edit></section>
      </div>
    </div>`;
  const listEl = root.querySelector("[data-list]"), editEl = root.querySelector("[data-edit]");
  // The card and the add-to-map question can be opened from other tabs (a token's Stats button), where this tab is hidden and
  // a pop-up inside it wouldn't show. So the pop-up lives at the top of the page instead.
  const doc0 = root.ownerDocument;
  doc0.querySelectorAll("dialog[data-crea-dlg]").forEach((d) => d.remove());
  const dlg = doc0.createElement("dialog");
  dlg.className = "campdlg";
  dlg.setAttribute("data-crea-dlg", "");
  doc0.body.appendChild(dlg);

  /* ----- saving ----- */
  const setStatus = (s) => { status = s; root.querySelector("[data-status]").textContent = STATUS[s]; };
  function touch() {
    dirty = true;
    setStatus("saving");
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }
  async function flush() {
    if (saving || !dirty || !doc) return;
    saving = true; dirty = false;
    let failed = false;
    try {
      const r = await call(`bestiary/${room}`, { method: "PUT", body: { doc }, pin });
      doc.rev = r.rev;
      if (!dirty) setStatus("saved");
    } catch {
      failed = true; dirty = true;
      setStatus("error");
    } finally {
      saving = false;
      if (dirty) { clearTimeout(timer); timer = setTimeout(flush, failed ? 2500 : 200); }
    }
  }
  window.addEventListener("beforeunload", (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ""; } });

  /* ----- the list ----- */
  const current = () => doc?.creatures.find((c) => c.id === selId);
  function visible() {
    const q = query.trim().toLowerCase();
    const list = doc.creatures.filter((c) => (filter === "all" || c.type === filter)
      && (!q || [c.name, c.kind, c.tags, c.role].some((t) => String(t).toLowerCase().includes(q))));
    const byName = (a, b) => (a.name || "~").localeCompare(b.name || "~", undefined, { sensitivity: "base" });
    if (sort === "cr") list.sort((a, b) => crValue(a.cr) - crValue(b.cr) || byName(a, b));
    else if (sort === "recent") list.sort((a, b) => b.updated - a.updated || byName(a, b));
    else list.sort(byName);
    return list;
  }
  const metaLine = (c) => [c.cr && `CR ${c.cr}`, c.ac && `AC ${c.ac}`, c.hp && `HP ${c.hp}`].filter(Boolean).join(" · ");

  function renderList() {
    if (!doc) { listEl.innerHTML = loadError ? `<p class="empty">${esc(loadError)} <button class="btn small" data-act="retry" type="button">Try again</button></p>` : '<p class="empty">Loading…</p>'; return; }
    const list = visible();
    listEl.innerHTML = list.map((c) => `<button type="button" class="crow ${c.id === selId ? "sel" : ""}" data-id="${c.id}">
      <span class="cname">${esc(c.name || "Unnamed")}</span><span class="ctype ${c.type}">${c.type === "npc" ? "NPC" : "Enemy"}</span>
      ${metaLine(c) ? `<small>${esc(metaLine(c))}</small>` : ""}${statSummary(c) ? `<small class="cs-sum">${esc(statSummary(c))}</small>` : ""}</button>`).join("")
      || `<p class="empty">${doc.creatures.length ? "Nothing matches that." : "No NPCs or enemies yet. Add your first one."}</p>`;
  }

  /* ----- the editor ----- */
  const inp = (f, v, ph, max, extra = "") => `<input type="text" data-cf="${f}" value="${esc(v)}" maxlength="${max}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" ${extra}>`;
  const ta = (f, v, rows, ph, max) => `<textarea data-cf="${f}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">${esc(v)}</textarea>`;

  function editHTML(c) {
    const npc = c.type === "npc";
    return `
      <div class="plrow creahead">
        ${inp("name", c.name, npc ? "NPC name" : "Creature name", 60, 'class="plname"')}
        <select data-cf="type" aria-label="NPC or enemy" style="width:auto"><option value="npc" ${npc ? "selected" : ""}>NPC</option><option value="enemy" ${npc ? "" : "selected"}>Enemy</option></select>
        <label class="cf crcr"><span>Challenge</span>${inp("cr", c.cr, "1/2", 12)}</label>
      </div>
      <div class="plrow">${inp("kind", c.kind, "Medium humanoid, neutral good", 100)}${inp("tags", c.tags, "Tags, separated by commas (town, Act 1, goblinoid)", 120)}</div>
      <div class="crea-actions">
        <button class="btn small primary" type="button" data-act="map">Add to map…</button>
        <button class="btn small" type="button" data-act="card">View card</button>
        <button class="btn small" type="button" data-act="dup">Duplicate</button>
        <button class="btn small danger" type="button" data-act="del">Delete</button>
      </div>
      ${npc ? `
      <fieldset class="crea-sec"><legend>Who they are</legend>
        <div class="plrow">${inp("role", c.role, "What they do (innkeeper, spy, captain of the guard...)", 120)}</div>
        <div class="plgrid2">
          <label class="cf"><span>Wants</span>${ta("wants", c.wants, 2, "What they want", 1000)}</label>
          <label class="cf"><span>Secret</span>${ta("secret", c.secret, 2, "What they're hiding", 1000)}</label>
          <label class="cf"><span>Voice and manner</span>${ta("voice", c.voice, 2, "How they sound and act", 500)}</label>
        </div>
      </fieldset>` : ""}
      <fieldset class="crea-sec"><legend>Stat block</legend>
        <div class="plgrid">
          <label class="cf"><span>Armor class</span>${inp("ac", c.ac, "15 (leather)", 30)}</label>
          <label class="cf"><span>Hit points</span><input type="number" inputmode="numeric" data-cf="hp" min="0" max="9999" value="${c.hp}"></label>
          <label class="cf"><span>HP dice</span>${inp("hpNote", c.hpNote, "6d8+12", 40)}</label>
          <label class="cf"><span>Speed</span>${inp("speed", c.speed, "30 ft.", 80)}</label>
          <label class="cf"><span>Usually appear</span><input type="number" inputmode="numeric" data-cf="count" min="1" max="20" value="${c.count || 1}"></label>
        </div>
        <div class="plabil">${ABIL.map((k) => `<label class="cf"><span>${k.toUpperCase()}</span>
          <input type="number" inputmode="numeric" data-cf="abilities.${k}" min="1" max="30" value="${c.abilities[k]}"><em data-mod="${k}">${sg(mod(c.abilities[k]))}</em></label>`).join("")}</div>
        <div class="plgrid2">
          <label class="cf"><span>Saving throws</span>${inp("saves", c.saves, "Dex +4, Wis +2", 120)}</label>
          <label class="cf"><span>Skills</span>${inp("skills", c.skills, "Stealth +6", 200)}</label>
          <label class="cf"><span>Resistances and immunities</span>${inp("resist", c.resist, "Poison", 250)}</label>
          <label class="cf"><span>Senses</span>${inp("senses", c.senses, "Darkvision 60 ft., passive Perception 11", 200)}</label>
          <label class="cf"><span>Languages</span>${inp("languages", c.languages, "Common, Goblin", 200)}</label>
        </div>
      </fieldset>
      ${attacksEditor(c)}${featuresEditor(c)}${spellcastingEditor(c)}
      <fieldset class="crea-sec"><legend>More text</legend>
        <p class="hint" style="margin:0">For anything that doesn't fit the boxes above. It shows on the stat card after them.</p>
        <label class="cf"><span>Other traits</span>${ta("traits", c.traits, 2, "Special traits, one per line", 4000)}</label>
        <label class="cf"><span>Other actions</span>${ta("actions", c.actions, 3, "Anything else the creature can do", 4000)}</label>
        <label class="cf"><span>Other bonus actions, reactions and legendary actions</span>${ta("extra", c.extra, 2, "Optional", 4000)}</label>
      </fieldset>
      <label class="cf"><span>${npc ? "Notes" : "Tactics and notes"}</span>${ta("notes", c.notes, 3, npc ? "Anything else worth remembering" : "How they fight, when they flee, what they carry", 3000)}</label>`;
  }

  function renderEdit() {
    const c = current();
    editEl.innerHTML = c ? editHTML(c) : `<div class="empty creaempty"><h2>${doc?.creatures.length ? "Pick someone from the list" : "Your library is empty"}</h2>
      <p>${doc?.creatures.length ? "Or add a new NPC or enemy." : "Make a stat block for an NPC or an enemy once, then add it to the map whenever you need it."}</p></div>`;
  }

  function render() { renderList(); renderEdit(); }

  function select(id) { selId = id; render(); }

  function addCreature(c, { focus = true } = {}) {
    doc.creatures.push(c);
    selId = c.id;
    touch();
    if (filter !== "all" && filter !== c.type) { filter = "all"; syncFilters(); }
    query = ""; root.querySelector("[data-q]").value = "";
    render();
    if (focus) editEl.querySelector('[data-cf="name"]')?.focus();
    return c;
  }

  function syncFilters() {
    root.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.filter === filter));
  }


  /* ----- attacks, special abilities and spellcasting ----- */
  const rowActions = `<span class="plact"><button class="x" type="button" data-up aria-label="Move up">↑</button><button class="x" type="button" data-down aria-label="Move down">↓</button><button class="x" type="button" data-del aria-label="Delete">×</button></span>`;
  const lf = (f, v, ph, max, extra = "") => `<input type="text" data-lf="${f}" value="${esc(v ?? "")}" maxlength="${max}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" ${extra}>`;
  const kindOpts = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${l}</option>`).join("");
  const abilOpts = (cur, none) => `${none ? `<option value="">${none}</option>` : ""}${ABIL.map((k) => `<option value="${k}" ${cur === k ? "selected" : ""}>${ABIL_NAMES[k]}</option>`).join("")}`;

  function attackRow(a) {
    const rolls = a.kind !== "save" && a.kind !== "other";
    return `<article class="plitem crea-item" data-list="attacks" data-id="${a.id}">
      <div class="plrow">${lf("name", a.name, "Scimitar", 60, 'class="plname"')}
        <select data-lf="kind" aria-label="Kind of attack">${kindOpts(ATTACK_KINDS, a.kind)}</select>${rowActions}</div>
      ${rolls ? `<div class="plgrid">
        <label class="cf"><span>To hit</span><input type="number" inputmode="numeric" data-lf="bonus" step="1" placeholder="+4" value="${a.bonus ?? ""}"></label>
        <label class="cf"><span>Reach or range</span>${lf("reach", a.reach, "reach 5 ft.", 60)}</label></div>` : ""}
      <div class="crea-dmg"><span class="crea-lbl">Damage</span>
        ${a.damage.map((d, i) => `<div class="plrow" data-dmg="${i}">${lf(`damage.${i}.dice`, d.dice, "1d6+2", 30)}${lf(`damage.${i}.type`, d.type, "slashing", 40)}
          <span class="hint crea-avg" data-avg>${diceAvg(d.dice) != null && /d/i.test(d.dice) ? `average ${diceAvg(d.dice)}` : ""}</span>
          <button class="x" type="button" data-deldmg aria-label="Remove this damage">×</button></div>`).join("")}
        ${a.damage.length < 4 ? '<button class="btn small ghost" type="button" data-adddmg>Add damage</button>' : ""}</div>
      <div class="plgrid"><label class="cf"><span>Saving throw</span><select data-lf="save.ability" aria-label="Saving throw">${abilOpts(a.save?.ability, "No saving throw")}</select></label>
        ${a.save ? `<label class="cf"><span>DC</span><input type="number" inputmode="numeric" data-lf="save.dc" min="1" max="40" value="${a.save.dc}"></label>
        <label class="cf"><span>On a success</span>${lf("save.onSave", a.save.onSave, "half damage", 80)}</label>` : ""}</div>
      <label class="cf"><span>Extra effects</span><textarea data-lf="notes" rows="2" maxlength="600" placeholder="The target is grappled (escape DC 13)…" aria-label="Extra effects">${esc(a.notes || "")}</textarea></label>
    </article>`;
  }
  function attacksEditor(c) {
    return `<fieldset class="crea-sec"><legend>Attacks <small>(${c.attacks.length})</small></legend>
      <p class="hint" style="margin:0">Attacks with their numbers. They read like a stat block, and can be rolled at the table.</p>
      ${c.attacks.map(attackRow).join("")}
      <div><button class="btn small" type="button" data-add="attack">Add an attack</button></div></fieldset>`;
  }

  function featureRow(f) {
    return `<article class="plitem crea-item" data-list="features" data-id="${f.id}">
      <div class="plrow">${lf("name", f.name, "Pack Tactics", 60, 'class="plname"')}
        <select data-lf="type" aria-label="Kind of ability">${kindOpts(FEATURE_TYPES, f.type)}</select>${rowActions}</div>
      <div class="plgrid"><label class="cf"><span>How often</span>${lf("uses", f.uses, "3/day, Recharge 5–6…", 40)}</label>
        ${f.type === "legendary" ? `<label class="cf"><span>Action cost</span><input type="number" inputmode="numeric" data-lf="cost" min="1" max="3" value="${f.cost || 1}"></label>` : ""}</div>
      <label class="cf"><span>What it does</span><textarea data-lf="text" rows="3" maxlength="1500" placeholder="The goblin has advantage on attack rolls when an ally is within 5 feet of the target." aria-label="What it does">${esc(f.text || "")}</textarea></label>
    </article>`;
  }
  function featuresEditor(c) {
    return `<fieldset class="crea-sec"><legend>Special abilities and actions <small>(${c.features.length})</small></legend>
      <p class="hint" style="margin:0">Traits, Multiattack, bonus actions, reactions and legendary actions, each on its own line of the stat block.</p>
      ${c.features.map(featureRow).join("")}
      <div><button class="btn small" type="button" data-add="feature">Add an ability</button></div></fieldset>`;
  }

  function spellRowEdit(sp, innate) {
    return `<article class="plitem crea-item crea-spell" data-list="spells" data-id="${sp.id}">
      <div class="plrow">${lf("name", sp.name, "Spell name", 60, 'class="plname"')}
        <select data-lf="level" aria-label="Spell level">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option value="${l}" ${Number(sp.level) === l ? "selected" : ""}>${l === 0 ? "Cantrip" : "Level " + l}</option>`).join("")}</select>
        ${innate ? lf("uses", sp.uses, "at will, 3/day…", 30, 'style="max-width:9rem"') : ""}${lf("note", sp.note, "note (range, damage…)", 160)}${rowActions}</div>
    </article>`;
  }
  function spellcastingEditor(c) {
    const sc = c.spellcasting;
    if (!sc) return `<fieldset class="crea-sec"><legend>Spellcasting</legend><div><button class="btn small" type="button" data-add="spellcasting">This creature casts spells</button></div></fieldset>`;
    return `<fieldset class="crea-sec"><legend>Spellcasting <small>(${sc.spells.length} spell${sc.spells.length === 1 ? "" : "s"})</small></legend>
      <div class="plgrid">
        <label class="cf"><span>Spellcasting ability</span><select data-sc="ability" aria-label="Spellcasting ability">${abilOpts(sc.ability, "Choose…")}</select></label>
        <label class="cf"><span>Spell save DC</span><input type="number" inputmode="numeric" data-sc="dc" min="1" max="40" value="${sc.dc ?? ""}"></label>
        <label class="cf"><span>Spell attack bonus</span><input type="number" inputmode="numeric" data-sc="atk" min="-5" max="30" value="${sc.atk ?? ""}"></label>
        ${sc.innate ? "" : `<label class="cf"><span>Caster level</span><input type="number" inputmode="numeric" data-sc="level" min="1" max="20" value="${sc.level ?? ""}"></label>`}
      </div>
      <div class="plrow" style="align-items:center">
        <label class="check"><input type="checkbox" data-sc="innate" ${sc.innate ? "checked" : ""}> Innate spellcasting (uses per day, no slots)</label>
        <button class="btn small ghost" type="button" data-fillsc title="Works out the DC and the attack bonus from the ability and the challenge rating">Fill the DC and bonus in</button>
      </div>
      ${sc.innate ? "" : `<div class="crea-slots"><span class="crea-lbl">Spell slots</span>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<label class="cf"><span>${ord(l)}</span><input type="number" inputmode="numeric" data-slot="${l}" min="0" max="9" value="${sc.slots[l] || ""}"></label>`).join("")}</div>`}
      ${sc.spells.map((sp) => spellRowEdit(sp, sc.innate)).join("")}
      <div class="plrow"><button class="btn small" type="button" data-add="spell">Add a spell</button>
        ${spellLib ? '<button class="btn small" type="button" data-pickspell>Add from the spell library…</button>' : ""}
        <button class="btn small danger ghost" type="button" data-nocast>Not a spellcaster</button></div>
    </fieldset>`;
  }

  /* what a creature's own text boxes and rows do */
  const setPath = (obj, path, value) => { const parts = path.split("."); let o = obj; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = value; };
  function rowOf(el, c) {
    const row = el.closest(".crea-item");
    if (!row) return null;
    const arr = { attacks: c.attacks, features: c.features, spells: c.spellcasting?.spells }[row.dataset.list];
    const rec = arr?.find((x) => x.id === row.dataset.id);
    return rec ? { row, arr, rec, list: row.dataset.list } : null;
  }
  function keepScroll(fn) { const y = editEl.scrollTop; fn(); editEl.scrollTop = y; }
  function redrawEditor(focusSel) { keepScroll(() => { renderEdit(); renderList(); }); if (focusSel) editEl.querySelector(focusSel)?.focus(); }

  editEl.addEventListener("input", (e) => {
    const t = e.target, c = current();
    if (!c) return;
    if (t.dataset.lf) {
      const r = rowOf(t, c);
      if (!r || t.tagName === "SELECT") return;
      const f = t.dataset.lf;
      let v = t.value;
      if (f === "bonus" || f === "save.dc" || f === "cost") { const n = parseInt(v); v = f === "bonus" ? (v === "" || !Number.isFinite(n) ? null : clamp(n, -10, 40)) : Number.isFinite(n) ? clamp(n, 1, 40) : null; if (v === null && f !== "bonus") return; }
      setPath(r.rec, f, v);
      if (/^damage\.\d+\.dice$/.test(f)) {   // show the average as they type
        const avg = r.row.querySelector(`[data-dmg="${f.split(".")[1]}"] [data-avg]`), a = diceAvg(t.value);
        if (avg) avg.textContent = a != null && /d/i.test(t.value) ? `average ${a}` : "";
      }
      c.updated = Date.now(); touch();
    } else if (t.dataset.sc && c.spellcasting && t.type !== "checkbox" && t.tagName !== "SELECT") {
      const f = t.dataset.sc, n = parseInt(t.value);
      c.spellcasting[f] = t.value === "" || !Number.isFinite(n) ? null : n;
      c.updated = Date.now(); touch();
    } else if (t.dataset.slot && c.spellcasting) {
      const n = parseInt(t.value);
      if (Number.isFinite(n) && n > 0) c.spellcasting.slots[t.dataset.slot] = clamp(n, 1, 9); else delete c.spellcasting.slots[t.dataset.slot];
      c.updated = Date.now(); touch();
    }
  });
  editEl.addEventListener("change", (e) => {
    const t = e.target, c = current();
    if (!c) return;
    if (t.dataset.lf) {
      const r = rowOf(t, c);
      if (!r || t.tagName !== "SELECT") return;
      const f = t.dataset.lf;
      if (f === "save.ability") {
        r.rec.save = t.value ? { ability: t.value, dc: r.rec.save?.dc ?? 10, onSave: r.rec.save?.onSave ?? "half damage on a success" } : null;
      } else if (f === "level") r.rec.level = Number(t.value);
      else setPath(r.rec, f, t.value);
      c.updated = Date.now(); touch();
      redrawEditor();   // the kind of attack or ability decides which boxes show
    } else if (t.dataset.sc && c.spellcasting) {
      const f = t.dataset.sc;
      if (f === "innate") c.spellcasting.innate = t.checked;
      else if (f === "ability") c.spellcasting.ability = t.value;
      c.updated = Date.now(); touch();
      redrawEditor();
    }
  });
  editEl.addEventListener("click", (e) => {
    const c = current();
    if (!c) return;
    const add = e.target.closest("[data-add]");
    if (add) {
      const k = add.dataset.add;
      if (k === "attack") { const a = blankAttack(); c.attacks.push(a); c.updated = Date.now(); touch(); redrawEditor(`[data-id="${a.id}"] [data-lf="name"]`); }
      else if (k === "feature") { const f = blankFeature(); c.features.push(f); c.updated = Date.now(); touch(); redrawEditor(`[data-id="${f.id}"] [data-lf="name"]`); }
      else if (k === "spellcasting") { c.spellcasting = blankSpellcasting(); c.updated = Date.now(); touch(); redrawEditor(); }
      else if (k === "spell" && c.spellcasting) { const sp = blankSpell(c.spellcasting.innate ? 0 : 1); c.spellcasting.spells.push(sp); c.updated = Date.now(); touch(); redrawEditor(`[data-id="${sp.id}"] [data-lf="name"]`); }
      return;
    }
    if (e.target.closest("[data-fillsc]") && c.spellcasting) {   // the usual numbers: 8 + proficiency + modifier, and proficiency + modifier
      const sc = c.spellcasting, m = sc.ability ? mod(c.abilities[sc.ability]) : null, P = profByCr(c.cr);
      if (m == null) { toast?.("Choose the spellcasting ability first."); return; }
      sc.dc = 8 + P + m; sc.atk = P + m; c.updated = Date.now(); touch(); redrawEditor();
      toast?.(`DC ${sc.dc} and ${sg(sc.atk)} to hit (proficiency ${sg(P)} for this challenge rating).`);
      return;
    }
    if (e.target.closest("[data-pickspell]")) { pickSpells(c); return; }
    const nc = e.target.closest("[data-nocast]");
    if (nc) {
      if (!nc.dataset.armed) { nc.dataset.armed = "1"; nc.textContent = "Remove all spellcasting?"; setTimeout(() => { if (nc.isConnected) { delete nc.dataset.armed; nc.textContent = "Not a spellcaster"; } }, 3000); }
      else { c.spellcasting = null; c.updated = Date.now(); touch(); redrawEditor(); }
      return;
    }
    const r = rowOf(e.target, c);
    if (!r) return;
    const i = r.arr.indexOf(r.rec);
    if (e.target.closest("[data-adddmg]") && r.list === "attacks") { r.rec.damage.push({ dice: "", type: "" }); c.updated = Date.now(); touch(); redrawEditor(`[data-id="${r.rec.id}"] [data-dmg="${r.rec.damage.length - 1}"] input`); return; }
    const dd = e.target.closest("[data-deldmg]");
    if (dd && r.list === "attacks") { r.rec.damage.splice(Number(dd.closest("[data-dmg]").dataset.dmg), 1); if (!r.rec.damage.length) r.rec.damage.push({ dice: "", type: "" }); c.updated = Date.now(); touch(); redrawEditor(); return; }
    const mv = e.target.closest("[data-up],[data-down]");
    if (mv) { const j = i + (mv.hasAttribute("data-up") ? -1 : 1); if (j >= 0 && j < r.arr.length) { [r.arr[i], r.arr[j]] = [r.arr[j], r.arr[i]]; c.updated = Date.now(); touch(); redrawEditor(); } return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Delete?"; del.classList.add("armed"); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "×"; del.classList.remove("armed"); } }, 3000); }
      else { r.arr.splice(i, 1); c.updated = Date.now(); touch(); redrawEditor(); }
    }
  });

  /* The spell library: search it and add spells to a creature without leaving the stat block. */
  async function pickSpells(c) {
    if (!spellLib || !c.spellcasting) return;
    await spellLib.load().catch(() => {});
    const has = (name) => c.spellcasting.spells.some((x) => x.name.toLowerCase() === name.toLowerCase());
    dlg.innerHTML = `<form>
      <h2>Add spells to ${esc(c.name || "this creature")}</h2>
      <div class="plrow"><input type="search" data-spq placeholder="Search ${spellLib.list.length} spells" aria-label="Search spells" autocomplete="off" style="flex:2">
        <select data-splv aria-label="Spell level" style="flex:1"><option value="">All levels</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option value="${l}">${l === 0 ? "Cantrips" : "Level " + l}</option>`).join("")}</select></div>
      <div class="libpick" data-splist style="margin-top:.5rem"></div>
      <div class="dlg-actions"><span class="hint" data-spcount style="margin-right:auto"></span><button type="button" class="btn primary" data-close>Done</button></div></form>`;
    const listEl2 = dlg.querySelector("[data-splist]"), q = dlg.querySelector("[data-spq]"), lv = dlg.querySelector("[data-splv]"), cnt = dlg.querySelector("[data-spcount]");
    const draw = () => {
      const found = spellLib.search(q.value, lv.value);
      listEl2.innerHTML = found.length ? found.map((e) => `<div class="libitem"><span><b>${esc(e.name)}</b><small>${e.level === 0 ? "Cantrip" : "Level " + e.level}${e.school ? " · " + esc(e.school) : ""}</small></span>
        <button type="button" class="btn small" data-spadd="${esc(e.name)}" ${has(e.name) ? "disabled" : ""}>${has(e.name) ? "Added" : "Add"}</button></div>`).join("") + (found.length >= 40 ? '<p class="hint">Showing the first 40. Type a name to narrow it down.</p>' : "") : '<p class="empty">No matches.</p>';
      cnt.textContent = `${c.spellcasting.spells.length} on this creature`;
    };
    q.addEventListener("input", draw); lv.addEventListener("change", draw);
    listEl2.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-spadd]");
      if (!b) return;
      const e2 = spellLib.find(b.dataset.spadd);
      if (!e2 || has(e2.name)) return;
      c.spellcasting.spells.push({ ...blankSpell(e2.level), name: e2.name });
      c.updated = Date.now(); touch(); draw(); redrawEditor();
    });
    dlg.querySelector("[data-close]").onclick = () => dlg.close();
    draw();
    if (!dlg.open) dlg.showModal();
    q.focus();
  }

  /* ----- header controls ----- */
  root.querySelector(".camphead").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filter = f.dataset.filter; syncFilters(); if (doc) renderList(); return; }
    const b = e.target.closest("[data-act]");
    if (!b || !doc) return;
    if (b.dataset.act === "new-npc") addCreature(blankCreature("npc"));
    else if (b.dataset.act === "new-enemy") addCreature(blankCreature("enemy"));
  });
  root.querySelector("[data-q]").addEventListener("input", (e) => { query = e.target.value; if (doc) renderList(); });
  root.querySelector("[data-sort]").addEventListener("change", (e) => { sort = e.target.value; if (doc) renderList(); });

  listEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-act='retry']")) { loadPromise = null; ensureLoaded(); return; }
    const row = e.target.closest("[data-id]");
    if (row) select(row.dataset.id);
  });

  /* ----- typing in the editor ----- */
  editEl.addEventListener("input", (e) => {
    const t = e.target, f = t.dataset.cf, c = current();
    if (!f || !c || t.tagName === "SELECT") return;
    if (f.startsWith("abilities.")) {
      const n = parseInt(t.value);
      if (!Number.isFinite(n)) return;
      const k = f.slice(10);
      c.abilities[k] = clamp(n, 1, 30);
      const m = editEl.querySelector(`[data-mod="${k}"]`);
      if (m) m.textContent = sg(mod(c.abilities[k]));
    } else if (f === "hp" || f === "count") {
      const n = parseInt(t.value);
      if (!Number.isFinite(n)) return;
      c[f] = f === "hp" ? clamp(n, 0, 9999) : clamp(n, 1, 20);
    } else c[f] = t.value;
    c.updated = Date.now();
    if (["name", "cr", "ac", "hp", "kind", "tags", "role"].includes(f)) renderList();
    touch();
  });
  editEl.addEventListener("change", (e) => {
    const t = e.target, c = current();
    if (!c || t.dataset.cf !== "type") return;
    c.type = t.value === "npc" ? "npc" : "enemy";
    c.updated = Date.now();
    touch();
    render();   // NPCs have extra fields
  });

  /* ----- what the buttons do ----- */
  editEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const c = current();
    if (!b || !c) return;
    switch (b.dataset.act) {
      case "map": askMap(c); break;
      case "card": openCard(c); break;
      case "dup": {
        const copy = { ...JSON.parse(JSON.stringify(c)), id: uid(), name: `${c.name || "Unnamed"} (copy)`, updated: Date.now() };
        addCreature(copy);
        toast?.("Copied. Edit the new one.");
        break;
      }
      case "del":
        if (!b.dataset.armed) {   // first tap asks, second tap deletes
          b.dataset.armed = "1"; b.textContent = "Really delete?";
          setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 3000);
        } else {
          const i = doc.creatures.findIndex((x) => x.id === c.id);
          doc.creatures.splice(i, 1);
          const next = visible()[0];
          selId = next ? next.id : "";
          touch();
          render();
        }
        break;
    }
  });

  /* ----- the stat block card, and putting creatures on the map ----- */
  function openCard(c, who = "") {
    bindCardRolls(dlg, rolls);
    dlg.innerHTML = `<div class="cardwrap">${cardHTML(c, { lib: spellFind, open: cardOpen, key: who ? `card:${c.id}:${who}` : "card:" + c.id, who, openByDefault: ["spells"] })}
      <div class="dlg-actions"><button type="button" class="btn" data-close>Close</button>
      <button type="button" class="btn" data-edit>Edit</button>
      <button type="button" class="btn primary" data-map>Add to map…</button></div></div>`;
    dlg.querySelector("[data-close]").onclick = () => dlg.close();
    bindOpenState(dlg, cardOpen);
    dlg.querySelector("[data-edit]").onclick = () => { dlg.close(); showTab?.(); select(c.id); };
    dlg.querySelector("[data-map]").onclick = () => askMap(c);
    if (!dlg.open) dlg.showModal();
  }

  function askMap(c) {
    if (!c.name.trim()) { toast?.("Give it a name first."); return; }
    const dex = mod(c.abilities.dex);
    dlg.innerHTML = `
      <form>
        <h2>Add ${esc(c.name.trim())} to the map</h2>
        <div class="field"><label for="cm_n">How many</label><input id="cm_n" name="count" type="number" min="1" max="20" value="${c.count || 1}"></div>
        <label class="check field"><input type="checkbox" name="init" checked> Add to the initiative list (${sg(dex)} for Dexterity)</label>
        <label class="check field"><input type="checkbox" name="hidden"> Hidden from players until I show them</label>
        <p class="hint">Each one starts with ${c.hp || "no"} hit points${c.type === "npc" ? " and shows as an NPC" : ""}.</p>
        <div class="dlg-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Add to map</button></div>
      </form>`;
    dlg.querySelector("[data-close]").onclick = () => dlg.close();
    dlg.querySelector("form").onsubmit = (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      const count = clamp(parseInt(d.count) || 1, 1, 20);
      const n = addToMap?.({ name: c.name.trim(), type: c.type, count, hp: c.hp || null, maxHp: c.hp || null, initMod: dex, hidden: d.hidden === "on", toInit: d.init === "on", cid: c.id });
      dlg.close();
      toast?.(n ? `${count} ${c.name.trim()} added to the map.` : "Couldn't add it to the map.");
    };
    if (!dlg.open) dlg.showModal();
  }

  /* ----- loading ----- */
  async function load() {
    try {
      const r = await call(`bestiary/${room}`, { pin });
      doc = { rev: r.doc.rev || 0, creatures: (r.doc.creatures || []).map(normalizeStats) };
      loadError = "";
      if (!current()) selId = visible()[0]?.id || "";
    } catch (err) {
      loadError = err.message || "Couldn't load the library.";
      loadPromise = null;
    }
    render();
    return !!doc;
  }
  const ensureLoaded = () => (loadPromise ||= load());

  render();

  /* ----- for the rest of the page ----- */
  return {
    load: ensureLoaded,
    /* Open a creature's stat block card. Resolves to false if it's no longer in the library. */
    async card(id, who = "") {
      await ensureLoaded();
      const c = doc?.creatures.find((x) => x.id === id);
      if (!c) return false;
      openCard(c, who);
      return true;
    },
    async edit(id) { await ensureLoaded(); if (doc?.creatures.some((x) => x.id === id)) { showTab?.(); select(id); return true; } return false; },
    async list() { await ensureLoaded(); return doc ? doc.creatures.map((c) => JSON.parse(JSON.stringify(c))) : []; },
    /* Save a creature to the library (for example from a session plan). Resolves to the saved creature, or null. */
    async add(spec) {
      await ensureLoaded();
      if (!doc) return null;
      const c = { ...blankCreature(spec.type === "npc" ? "npc" : "enemy"), ...JSON.parse(JSON.stringify(spec)), id: uid(), updated: Date.now() };
      c.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...(spec.abilities || {}) };
      normalizeStats(c);
      addCreature(c, { focus: false });
      return c;
    },
  };
}
