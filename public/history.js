"use strict";

const $history = document.getElementById("history");
const $addBtn = document.getElementById("addBtn");
const $status = document.getElementById("status");

let data = null; // { people:[{id,name}], sessions:[...], totals:{...} }
let editingId = null; // a session id, or "new", or null
let busy = false;

function setStatus(msg, isError) {
  $status.textContent = msg || "";
  $status.classList.toggle("err", !!isError);
}

async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
  return payload;
}

function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function todayLocal() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

function firstName(name) {
  return name.split(" ")[0];
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.assign(node, props || {});
  for (const c of children || []) {
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function viewCard(session) {
  const card = el("article", { className: "hist-card" });
  card.append(el("div", { className: "hist-date" }, [fmtDate(session.date)]));

  const counts = el("div", { className: "hist-counts" });
  for (const p of data.people) {
    counts.append(
      el("div", { className: "hist-count" }, [
        el("span", { className: "hist-count-name" }, [firstName(p.name)]),
        el("span", { className: "hist-count-num" }, [session[p.id]]),
      ])
    );
  }
  card.append(counts);

  if (session.note) {
    card.append(el("p", { className: "hist-note" }, [session.note]));
  }

  const edit = el("button", { type: "button", className: "btn-edit" }, ["Edit"]);
  edit.addEventListener("click", () => {
    editingId = session.id;
    render();
  });
  card.append(el("div", { className: "hist-card-actions" }, [edit]));
  return card;
}

function editCard(session, isNew) {
  const card = el("article", { className: "hist-card editing" });

  const dateInput = el("input", {
    type: "date",
    className: "field-date",
    value: session.date || todayLocal(),
  });
  card.append(
    el("label", { className: "field" }, [
      el("span", { className: "field-label" }, ["Date"]),
      dateInput,
    ])
  );

  const numInputs = {};
  const grid = el("div", { className: "field-grid" });
  for (const p of data.people) {
    const input = el("input", {
      type: "number",
      inputMode: "numeric",
      min: "0",
      max: "99",
      className: "field-num",
      value: session[p.id] != null ? String(session[p.id]) : "0",
    });
    numInputs[p.id] = input;
    grid.append(
      el("label", { className: "field" }, [
        el("span", { className: "field-label" }, [firstName(p.name)]),
        input,
      ])
    );
  }
  card.append(grid);

  const noteInput = el("input", {
    type: "text",
    className: "field-note",
    maxLength: 280,
    placeholder: "Note (optional)",
    value: session.note || "",
  });
  card.append(
    el("label", { className: "field" }, [
      el("span", { className: "field-label" }, ["Note"]),
      noteInput,
    ])
  );

  const save = el("button", { type: "button", className: "btn-save-row" }, [
    isNew ? "Add" : "Save",
  ]);
  save.addEventListener("click", () => {
    const body = {
      date: dateInput.value,
      note: noteInput.value.trim(),
    };
    for (const p of data.people) {
      body[p.id] = clampInt(numInputs[p.id].value);
    }
    if (isNew) submit("/api/history", "POST", body, "Session added");
    else submit("/api/history", "PATCH", { id: session.id, ...body }, "Saved");
  });

  const cancel = el("button", { type: "button", className: "btn-ghost" }, ["Cancel"]);
  cancel.addEventListener("click", () => {
    editingId = null;
    render();
  });

  const actions = [save, cancel];
  if (!isNew) {
    const del = el("button", { type: "button", className: "btn-danger" }, ["Delete"]);
    del.addEventListener("click", () => {
      if (!confirm(`Delete the ${fmtDate(session.date)} session? This can't be undone.`)) {
        return;
      }
      submit("/api/history", "DELETE", { id: session.id }, "Session deleted");
    });
    actions.push(del);
  }
  card.append(el("div", { className: "hist-card-actions" }, actions));
  return card;
}

function clampInt(v) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 99) n = 99;
  return n;
}

async function submit(path, method, body, okMsg) {
  if (busy) return;
  busy = true;
  setStatus("Saving…");
  try {
    data = await api(path, method, body);
    editingId = null;
    render();
    setStatus(okMsg + " ✓");
  } catch (e) {
    setStatus(e.message || "Save failed", true);
  } finally {
    busy = false;
  }
}

function totalsCard() {
  const card = el("article", { className: "hist-card totals" });
  card.append(el("div", { className: "hist-date" }, ["Lifetime (from history)"]));
  const counts = el("div", { className: "hist-counts" });
  for (const p of data.people) {
    counts.append(
      el("div", { className: "hist-count" }, [
        el("span", { className: "hist-count-name" }, [firstName(p.name)]),
        el("span", { className: "hist-count-num strong" }, [data.totals[p.id]]),
      ])
    );
  }
  card.append(counts);
  card.append(
    el("p", { className: "hist-note" }, [
      `${data.sessions.length} session${data.sessions.length === 1 ? "" : "s"} recorded`,
    ])
  );
  return card;
}

function render() {
  if (!data) return;
  $history.innerHTML = "";
  $history.append(totalsCard());

  if (editingId === "new") {
    $history.append(editCard({ date: todayLocal() }, true));
  }

  const newestFirst = [...data.sessions].reverse();
  if (newestFirst.length === 0 && editingId !== "new") {
    $history.append(el("p", { className: "loading" }, ["No sessions yet."]));
  }
  for (const s of newestFirst) {
    $history.append(editingId === s.id ? editCard(s, false) : viewCard(s));
  }

  $addBtn.disabled = editingId === "new";
}

$addBtn.addEventListener("click", () => {
  editingId = "new";
  render();
  $history.scrollIntoView({ behavior: "smooth", block: "start" });
});

(async function init() {
  try {
    data = await api("/api/history");
    render();
  } catch (e) {
    $history.innerHTML = `<p class="loading">Couldn't load history. Refresh to try again.</p>`;
  }
})();
