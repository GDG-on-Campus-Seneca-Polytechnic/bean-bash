// The arena's question editor. The room holds the set for its games; this laptop keeps a
// copy in localStorage so the next room starts with the same questions.
// Everything typed here is shown with .value and .textContent only, never as HTML.
import { checkQuestions, LIMITS } from "./question-rules.js";

const STORAGE_KEY = "beanQuestions";
const ZONE_NAMES = ["Blue", "Red", "Yellow", "Green"];
const el = (id) => document.getElementById(id);

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const result = checkQuestions(JSON.parse(raw));
    if (result.ok) return result.list;
  } catch {
    /* private mode or a broken copy */
  }
  forgetStored();
  return null;
}

function store(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode: the room still has the set */
  }
}

function forgetStored() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

const copy = (list) => list.map((q) => ({ text: q.text, answers: [...q.answers], correct: q.correct }));

// Export format: the same shape as src/questions.json.
export function exportText(list) {
  const result = checkQuestions(list);
  if (!result.ok) throw new Error(result.error);
  return JSON.stringify(result.list, null, 2) + "\n";
}

// Accepts a plain list (like src/questions.json) or { questions: [...] }.
export function importText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (data && !Array.isArray(data) && Array.isArray(data.questions)) data = data.questions;
  const result = checkQuestions(data);
  if (!result.ok) throw new Error(result.error);
  return result.list;
}

export function createEditor({ send, isConnected }) {
  const dialog = el("editor");
  const list = el("edList");
  const status = el("edStatus");
  const button = el("questionsBtn");

  let phase = null;
  let syncedThisSocket = false;
  let server = null; // last { list, builtIn, custom } from the room
  let draft = [];
  let draftIsBuiltIn = false;
  let dirty = false;
  let waitingForList = false;
  let saving = false;

  function setStatus(text, kind = "") {
    status.textContent = text;
    status.className = kind;
  }

  function paintButton() {
    if (!server) {
      button.textContent = "Questions";
      return;
    }
    const n = server.list.length;
    button.textContent = `Questions (${n}${server.custom ? ", custom" : ""})`;
  }

  function paintSource() {
    const n = draft.length;
    const source = draftIsBuiltIn ? "built-in set" : "custom set";
    el("edSource").textContent = `${n} question${n === 1 ? "" : "s"} · ${source}`;
    el("edAdd").disabled = n >= LIMITS.maxQuestions;
  }

  function changed({ content = true } = {}) {
    dirty = true;
    if (content) draftIsBuiltIn = false;
    paintSource();
    setStatus("Unsaved changes. Press Save to use them.");
  }

  function counter(input, max) {
    const count = document.createElement("span");
    count.className = "edCount";
    const update = () => {
      const length = input.value.replace(/\s+/g, " ").trim().length;
      count.textContent = `${length}/${max}`;
      count.classList.toggle("over", length > max);
    };
    update();
    return { count, update };
  }

  function row(question, index) {
    const li = document.createElement("li");
    li.className = "edItem";

    const num = document.createElement("div");
    num.className = "edNum";
    num.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "edBody";

    const textField = document.createElement("div");
    textField.className = "edField";
    const text = document.createElement("textarea");
    text.rows = 2;
    text.maxLength = LIMITS.maxText;
    text.placeholder = "Question text";
    text.value = question.text;
    text.setAttribute("aria-label", `Question ${index + 1} text`);
    const textCount = counter(text, LIMITS.maxText);
    text.addEventListener("input", () => {
      question.text = text.value;
      textCount.update();
      li.classList.remove("bad");
      changed();
    });
    textField.append(text, textCount.count);

    const answers = document.createElement("div");
    answers.className = "edAnswers";
    const answerRows = question.answers.map((answer, a) => {
      const wrap = document.createElement("div");
      wrap.className = "edAnswer";
      wrap.dataset.zone = String(a);
      wrap.classList.toggle("correct", question.correct === a);

      const label = document.createElement("label");
      label.title = "Mark as the correct answer";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `correct-${index}`;
      radio.checked = question.correct === a;
      radio.addEventListener("change", () => {
        question.correct = a;
        answerRows.forEach((other, b) => other.classList.toggle("correct", b === a));
        li.classList.remove("bad");
        changed();
      });
      label.append(radio, document.createTextNode("Correct"));

      const field = document.createElement("div");
      field.className = "edField";
      field.style.flex = "1";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = LIMITS.maxAnswer;
      input.placeholder = `${ZONE_NAMES[a]} platform answer`;
      input.value = answer;
      input.setAttribute("aria-label", `Question ${index + 1}, ${ZONE_NAMES[a]} answer`);
      const answerCount = counter(input, LIMITS.maxAnswer);
      input.addEventListener("input", () => {
        question.answers[a] = input.value;
        answerCount.update();
        li.classList.remove("bad");
        changed();
      });
      field.append(input, answerCount.count);
      wrap.append(field, label);
      return wrap;
    });
    answers.append(...answerRows);
    body.append(textField, answers);

    const moves = document.createElement("div");
    moves.className = "edMoves";
    const tool = (label, title, disabled, action, extra = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `icon ${extra}`.trim();
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", `${title} (question ${index + 1})`);
      b.disabled = disabled;
      b.addEventListener("click", action);
      return b;
    };
    moves.append(
      tool("↑", "Move up", index === 0, () => move(index, -1)),
      tool("↓", "Move down", index === draft.length - 1, () => move(index, 1)),
      tool("✕", "Delete", draft.length <= 1, () => {
        draft.splice(index, 1);
        changed();
        renderList();
      }, "danger")
    );

    li.append(num, body, moves);
    return li;
  }

  function move(index, by) {
    const to = index + by;
    if (to < 0 || to >= draft.length) return;
    [draft[index], draft[to]] = [draft[to], draft[index]];
    changed({ content: false });
    renderList();
  }

  function renderList() {
    list.replaceChildren(...draft.map(row));
    paintSource();
  }

  function loadDraft(questions, builtIn) {
    draft = copy(questions);
    draftIsBuiltIn = builtIn;
    dirty = false;
    renderList();
  }

  function open() {
    if (phase !== "lobby" || dialog.open) return;
    draft = [];
    renderList();
    setStatus(isConnected() ? "Loading the room's questions…" : "Not connected to the room yet.");
    waitingForList = true;
    send({ type: "getQuestions" });
    dialog.showModal();
  }

  function close({ force = false } = {}) {
    if (!dialog.open) return;
    if (!force && dirty && !confirm("Close without saving your changes?")) return;
    waitingForList = false;
    saving = false;
    dialog.close();
  }

  function save() {
    if (saving) return;
    const result = checkQuestions(draft);
    if (!result.ok) {
      setStatus(result.error, "error");
      const bad = list.children[result.index];
      if (bad) {
        bad.classList.add("bad");
        bad.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return;
    }
    if (phase !== "lobby") return setStatus("Questions can only be changed in the lobby.", "error");
    if (!isConnected()) return setStatus("Not connected to the room. Try again in a moment.", "error");
    saving = true;
    setStatus("Saving…");
    send({ type: "questions", list: draftIsBuiltIn ? null : result.list });
  }

  function download() {
    let text;
    try {
      text = exportText(draft);
    } catch (error) {
      return setStatus(`Can't export yet. ${error.message}`, "error");
    }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bean-bash-questions.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${draft.length} questions.`, "ok");
  }

  function loadImport(text) {
    try {
      const imported = importText(text);
      draft = imported;
      draftIsBuiltIn = false;
      dirty = true;
      renderList();
      setStatus(`Imported ${imported.length} questions. Press Save to use them.`, "ok");
      return imported.length;
    } catch (error) {
      setStatus(`Import failed. ${error.message}`, "error");
      return 0;
    }
  }

  el("questionsBtn").addEventListener("click", open);
  el("edClose").addEventListener("click", () => close());
  el("edCancel").addEventListener("click", () => close());
  el("edSave").addEventListener("click", save);
  el("edExport").addEventListener("click", download);
  el("edImport").addEventListener("click", () => el("edFile").click());
  el("edFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 200000) return setStatus("Import failed. That file is too big for a question set.", "error");
    loadImport(await file.text());
  });
  el("edAdd").addEventListener("click", () => {
    if (draft.length >= LIMITS.maxQuestions) return;
    draft.push({ text: "", answers: ["", "", "", ""], correct: 0 });
    changed();
    renderList();
    const last = list.lastElementChild;
    last.scrollIntoView({ block: "nearest" });
    last.querySelector("textarea").focus();
  });
  el("edShuffle").addEventListener("click", () => {
    for (let i = draft.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [draft[i], draft[j]] = [draft[j], draft[i]];
    }
    changed({ content: false });
    renderList();
  });
  el("edReset").addEventListener("click", () => {
    if (!server) return;
    loadDraft(server.builtIn, true);
    dirty = true;
    setStatus("Built-in questions loaded. Press Save to use them.", "ok");
  });
  // Esc inside the dialog closes it (with a check for unsaved changes), never "New game".
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });

  return {
    isOpen: () => dialog.open,
    open,

    // A new socket: send this laptop's saved set, once we know the room is in the lobby.
    onSocketOpen() {
      syncedThisSocket = false;
    },

    onState(state) {
      phase = state.phase;
      if (phase !== "lobby" && dialog.open) close({ force: true });
      if (syncedThisSocket) return;
      syncedThisSocket = true;
      const stored = loadStored();
      if (stored && phase === "lobby") send({ type: "questions", list: stored, auto: true });
      else send({ type: "getQuestions" });
    },

    // Replies from the room. Returns true when the message was for the editor.
    onMessage(message) {
      if (message.type === "questionList") {
        server = { list: message.list, builtIn: message.builtIn, custom: message.custom };
        paintButton();
        if (message.saved) {
          if (message.custom) store(message.list);
          else forgetStored();
        }
        if (saving && message.saved) {
          saving = false;
          dirty = false;
          loadDraft(message.list, !message.custom);
          setStatus(`Saved. This room now uses ${message.list.length} ${message.custom ? "custom" : "built-in"} questions.`, "ok");
          setTimeout(() => close(), 900);
        } else if (waitingForList && dialog.open) {
          waitingForList = false;
          loadDraft(message.list, !message.custom);
          setStatus(message.custom ? "This room uses a custom set." : "This room uses the built-in set.");
        }
        return true;
      }
      if (message.type === "questionsError") {
        if (saving) {
          saving = false;
          setStatus(message.error, "error");
        } else {
          console.warn("Question set not applied:", message.error);
        }
        return true;
      }
      return false;
    },

    // For rehearsals and tests from the console.
    debug: {
      get draft() {
        return draft;
      },
      exportText: () => exportText(draft),
      importText: loadImport,
      save,
    },
  };
}
