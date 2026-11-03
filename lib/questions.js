// 子代理 → 主代理 → 用户 的提问中转：状态存在 workspace/.mmw/state.json 的 questions 里。

export function ensureQuestions(state) {
  if (!Array.isArray(state.questions)) state.questions = [];
  return state.questions;
}

let counter = 0;

/** 追加一个问题，返回问题对象。 */
export function addQuestion(state, { step, question, options = [], blocking = true }) {
  const list = ensureQuestions(state);
  counter += 1;
  const item = {
    id: `q${Date.now().toString(36)}${counter}`,
    step,
    question,
    options: Array.isArray(options) ? options.filter(Boolean) : [],
    blocking: blocking !== false,
    status: 'open',
    answer: '',
    askedAt: new Date().toISOString(),
    answeredAt: null,
  };
  list.push(item);
  return item;
}

/** 未回答的问题（可按步骤过滤）。 */
export function openQuestions(state, step) {
  return ensureQuestions(state).filter((q) => q.status === 'open' && (!step || q.step === step));
}

/** 记录回答；找不到返回 null。 */
export function answerQuestion(state, id, answer) {
  const target = ensureQuestions(state).find((q) => q.id === id && q.status === 'open');
  if (!target) return null;
  target.status = 'answered';
  target.answer = String(answer ?? '');
  target.answeredAt = new Date().toISOString();
  return target;
}

/** 给子代理的简短清单（紧凑，避免刷屏）。 */
export function describeOpen(state, step) {
  return openQuestions(state, step).map((q) => `- [${q.id}] ${q.question}${q.options.length ? `（可选：${q.options.join(' / ')}）` : ''}`);
}
