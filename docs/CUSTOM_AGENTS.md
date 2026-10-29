# Add SanskritLearning to your own agent

SanskritLearning can read your agent's answers aloud when the user asks by voice. You add **two lines** to your code. It takes about five minutes.

## 1. Copy one file into your project

- **Python:** `sanskrit_learning.py`
- **Node.js:** `client.cjs`

You'll find both in `%LOCALAPPDATA%\SanskritLearning\app\src\pc\`. Put the file **in the same folder as the code that handles the user's message**: the place where your agent receives the message and produces its answer.

## 2. Add two lines

Find the function that receives the user's message and returns the answer. Add one line at the start and one at the end.

**Python:**

```python
import sanskrit_learning

def handle_message(message):
    t = sanskrit_learning.turn(message, agent="my-agent")                    # line 1: message arrived

    answer = your_agent(message)                                  # your existing code

    sanskrit_learning.speak(answer, agent="my-agent", turn_id=t["turnId"])   # line 2: answer ready
    return answer
```

**Node.js:**

```js
const sanskrit_learning = require('./client.cjs');

async function handleMessage(message) {
  const t = await sanskrit_learning.turn(message, { agent: 'my-agent' });              // line 1

  const answer = await yourAgent(message);                                  // your existing code

  await sanskrit_learning.speak(answer, { agent: 'my-agent', turnId: t.turnId });      // line 2
  return answer;
}
```

Four rules:

- Pass the user's message **exactly as they sent it**, before you add any system prompt or history.
- Pass the **final answer** the user sees, not in-between steps.
- If your function is `async` in Python (FastAPI, aiohttp), wrap the calls so they don't block:
  `t = await asyncio.to_thread(sanskrit_learning.turn, message, agent="my-agent")`, and the same for `speak`.
- These calls never crash and never slow your agent down. If SanskritLearning isn't running, they quietly do nothing.

## 3. Test it

1. Make sure SanskritLearning is running (its icon is in the system tray).
2. Start your agent.
3. Press **Ctrl+Shift+U**, say a question, press **Ctrl+Shift+U** again, and send it. **The answer is read aloud.**
4. Type a question normally and send it. **Nothing is read aloud.** That's correct: SanskritLearning only speaks when you asked by voice.

## Not working?

Print what the two calls return:

```python
r = sanskrit_learning.speak(answer, agent="my-agent", turn_id=t["turnId"])
print(t["reason"], r["reason"])
```

| You see | Meaning |
|---|---|
| `unavailable` | SanskritLearning isn't running. Start it from the Start menu. |
| `no_match` | The text you passed to `turn()` isn't the user's message. Pass the plain message. |
| `not_talkback` | You typed instead of using Ctrl+Shift+U, or the `turn_id` wasn't passed to `speak()`. |
| `match`, then `queued` | Working. If you hear nothing, check your speakers. |

Multiple conversations, streaming answers, other languages and every other detail: see the [full reference](CUSTOM_AGENTS_REFERENCE.md).
