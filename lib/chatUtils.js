export const createMessage = (role, content = '') => ({
  role,
  type: role === 'user' ? 'userMessage' : 'apiMessage',
  content,
});

export const messageRole = (message) => {
  if (message.role) return message.role;
  if (message.type === 'userMessage') return 'user';
  return 'assistant';
};

export const computeHistoryPairs = (conversation) => {
  const pairs = [];
  let pendingUser = null;

  for (const entry of conversation) {
    const role = messageRole(entry);
    if (role === 'user') {
      pendingUser = entry.content ?? '';
    } else if (role === 'assistant' && pendingUser) {
      const assistantContent = entry.content ?? '';
      if (assistantContent) {
        pairs.push([pendingUser, assistantContent]);
        pendingUser = null;
      }
    }
  }

  return pairs;
};
