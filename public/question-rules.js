// The rules for a question set. Shared by the arena's editor and the room server,
// so a list the editor accepts is exactly a list the room accepts.

export const LIMITS = {
  minQuestions: 1,
  maxQuestions: 50,
  maxText: 140,
  maxAnswer: 40,
  answers: 4,
};

const tidy = (value) => value.replace(/\s+/g, " ").trim();

// Returns { ok: true, list } with fresh, tidied objects, or { ok: false, error }.
// Extra keys on a question are dropped; anything else that doesn't fit is an error.
export function checkQuestions(list) {
  if (!Array.isArray(list)) return fail("The question set must be a list.");
  if (list.length < LIMITS.minQuestions) return fail("Add at least one question.");
  if (list.length > LIMITS.maxQuestions) {
    return fail(`Too many questions: ${list.length}. The limit is ${LIMITS.maxQuestions}.`);
  }
  const clean = [];
  for (let i = 0; i < list.length; i++) {
    const n = i + 1;
    const fail = (error) => ({ ok: false, error, index: i });
    const item = list[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail(`Question ${n} is not a question.`);
    if (typeof item.text !== "string") return fail(`Question ${n}: the question text is missing.`);
    const text = tidy(item.text);
    if (!text) return fail(`Question ${n}: the question text is empty.`);
    if (text.length > LIMITS.maxText) {
      return fail(`Question ${n}: the text is ${text.length} characters. The limit is ${LIMITS.maxText}.`);
    }
    if (!Array.isArray(item.answers) || item.answers.length !== LIMITS.answers) {
      return fail(`Question ${n}: it needs exactly ${LIMITS.answers} answers.`);
    }
    const answers = [];
    for (let a = 0; a < LIMITS.answers; a++) {
      const raw = item.answers[a];
      if (typeof raw !== "string") return fail(`Question ${n}, answer ${a + 1}: the answer must be text.`);
      const answer = tidy(raw);
      if (!answer) return fail(`Question ${n}, answer ${a + 1}: the answer is empty.`);
      if (answer.length > LIMITS.maxAnswer) {
        return fail(`Question ${n}, answer ${a + 1}: ${answer.length} characters. The limit is ${LIMITS.maxAnswer}.`);
      }
      answers.push(answer);
    }
    const correct = item.correct;
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      return fail(`Question ${n}: pick which answer is correct.`);
    }
    clean.push({ text, answers, correct });
  }
  return { ok: true, list: clean };
}

function fail(error) {
  return { ok: false, error };
}
