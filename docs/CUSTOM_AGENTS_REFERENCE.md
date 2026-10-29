# Custom agents

Connect an agent you built yourself, so that its answer is read aloud when the user asked by voice. Your agent makes two calls: one when the user's message arrives, one when the final answer is ready. SanskritLearning decides whether to speak.

What you need:

- SanskritLearning installed and running on the same PC, signed in as the same Windows user as your agent. The service only answers on `127.0.0.1`, and its access token is readable only by that user.
- Python 3.8 or later, or Node.js. Any other language can use the [HTTP API](#http-api) directly.

Building SanskritLearning itself, or adding a built-in agent with lifecycle hooks? See the [developer guide](DEVELOPER_GUIDE.md).

## Quick start

1. **Copy one client file** next to your code: `sanskrit_learning.py` or `client.cjs` (see [step 1](#1-copy-a-client)).
2. **Check that SanskritLearning is running** (see [step 2](#2-check-that-sanskritlearning-is-running)).
3. **Run the echo agent** and confirm that a talk-back message is spoken (see [step 3](#3-confirm-your-setup-with-the-echo-agent)).
4. **Find the two places in your agent**: where the user's text arrives, and where the final answer is ready (see [step 4](#4-find-the-two-places-in-your-agent)).
5. **Add `turn()` and `speak()`** at those places (see [step 5](#5-add-the-two-calls)).
6. **Run the [manual test](#manual-test)**.

## How it works

```text
 user presses Ctrl+Shift+U, speaks, presses Ctrl+Shift+U
        │
        ▼
 SanskritLearning transcribes and remembers the text as the talk-back draft ──────────────┐
        │                                                                       │
        ▼                                                                       │
 the text is pasted into your agent's input box (or put on the clipboard)       │
        │                                                                       │
        ▼                                                                       │
 the user sends it; your UI passes it to your backend                           │
        │                                                                       │
        ▼                                                                       │
 your backend calls turn(text) ──────► SanskritLearning compares text with the draft ◄────┘
        │                                    match: this turn owns the talk-back
        ▼                                    no_match: this turn's answer stays silent
 your agent works out the answer
        │
        ▼
 your backend calls speak(answer, turn_id) ──► owned turn: SanskritLearning reads the answer aloud
                                               otherwise: silent
```

SanskritLearning never sees what the user typed or dictated into your agent. It only knows the text it transcribed, and the texts your agent reports. That is why your agent must report every message with `turn()`: SanskritLearning works out from the text whether that message was the voice one.

Only messages dictated with **Ctrl+Shift+U** get a spoken answer. Typed messages and plain dictation (**Ctrl+Shift+I**) never do. There is no way to make SanskritLearning speak an answer the user didn't ask for by voice.

## 1. Copy a client

Each client is one file with no dependencies. It finds the running service, adds the token, and never raises an error into your code.

| Language | File | Where to copy it from |
|---|---|---|
| Python 3.8+ | `sanskrit_learning.py` | `%LOCALAPPDATA%\SanskritLearning\app\src\pc\sanskrit_learning.py`, or `src/pc/sanskrit_learning.py` in this repository |
| Node.js | `client.cjs` | `%LOCALAPPDATA%\SanskritLearning\app\src\pc\client.cjs`, or `src/pc/client.cjs` in this repository |

Copy the file into your project rather than importing it from the install folder: uninstalling SanskritLearning deletes that folder, and setup replaces it on every update. A copied client keeps working when SanskritLearning is not installed. Every call then answers `unavailable`, and your agent carries on.

The clients don't check the service version. The service reports its version in `/health` (`"version"`) and in `endpoint.json`.

## 2. Check that SanskritLearning is running

With `sanskrit_learning.py` in the current folder:

```powershell
python -c "import sanskrit_learning, json; print(json.dumps(sanskrit_learning.status(), indent=1))"
```

With `client.cjs` in the current folder:

```powershell
node -e "require('./client.cjs').status().then(s=>console.log(JSON.stringify(s,null,1)))"
```

`null` (Node) or `None` (Python) means SanskritLearning isn't running: start it from **Start → SanskritLearning**. A running service answers like this (trimmed):

```json
{
 "version": "0.8.0",
 "phase": "ready",
 "models": "unloaded",
 "readMode": "talkback",
 "talkback": "none",
 "hotkeys": {"capture": "Ctrl+Shift+I", "disarm": "Ctrl+Shift+Y", "talkback": "Ctrl+Shift+U"},
 "paused": false,
 "requests": {"total": 0, "accepted": 0, "rejected": 0, "byReason": {}},
 "lastRejected": null
}
```

- `readMode`: `"talkback"` (answers to voice messages are spoken) or `"off"` (nothing is spoken). Set in the tray menu.
- `talkback`: what is waiting right now. `"none"`, `"dictation"` (the user dictated with Ctrl+Shift+U and no turn has matched it yet) or `"turn"` (a turn matched, and its answer will be spoken). Useful while debugging.
- `paused`: `true` when the user chose **Pause hotkeys** in the tray. Every call then answers `paused`.
- `models: "unloaded"` is normal: the speech models load on first use and unload after 15 idle minutes.

## 3. Confirm your setup with the echo agent

Before touching your real agent, run this echo agent. It answers with what you said.

**Python**: save as `echo_agent.py` next to `sanskrit_learning.py`, then run `python echo_agent.py`:

```python
"""Echo agent: answers with what you said. SanskritLearning speaks the answer when you dictated with Ctrl+Shift+U."""
import sanskrit_learning  # sanskrit_learning.py, copied next to this file

AGENT = "echo-agent"   # any name you like; turn() and speak() must use the same one
SESSION = "echo-1"     # one conversation; use your own conversation ID in a real agent


def main():
    health = sanskrit_learning.status()
    if health is None:
        print("SanskritLearning is not running. Start it from Start > SanskritLearning, then run this again.")
        return
    print(f"SanskritLearning {health['version']} is running. Read-aloud mode: {health['readMode']}.")
    print("Type a message, or dictate one with Ctrl+Shift+U and paste it (Ctrl+V). Ctrl+C quits.")
    while True:
        try:
            message = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not message:
            continue
        t = sanskrit_learning.turn(message, agent=AGENT, session_id=SESSION)           # 1. the user's text arrived
        answer = "You said: " + message                                       # 2. your agent works here
        print("Agent:", answer)
        r = sanskrit_learning.speak(answer, agent=AGENT, session_id=SESSION, turn_id=t["turnId"])  # 3. final answer ready
        print(f"  [sanskrit_learning] turn={t['reason']} reply={r['reason']}")


if __name__ == "__main__":
    main()
```

**Node**: save as `echo-agent.cjs` next to `client.cjs`, then run `node echo-agent.cjs`:

```js
// Echo agent: answers with what you said. SanskritLearning speaks the answer when you dictated with Ctrl+Shift+U.
const readline = require('node:readline');
const sanskrit_learning = require('./client.cjs'); // client.cjs, copied next to this file

const AGENT = 'echo-agent';  // any name you like; turn() and speak() must use the same one
const SESSION = 'echo-1';    // one conversation; use your own conversation ID in a real agent

async function main() {
  const health = await sanskrit_learning.status();
  if (!health) { console.log('SanskritLearning is not running. Start it from Start > SanskritLearning, then run this again.'); return; }
  console.log(`SanskritLearning ${health.version} is running. Read-aloud mode: ${health.readMode}.`);
  console.log('Type a message, or dictate one with Ctrl+Shift+U and paste it (Ctrl+V). Ctrl+C quits.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'You: ' });
  let closed = false; rl.on('close', () => { closed = true; });
  rl.prompt();
  for await (const line of rl) {
    const message = line.trim();
    if (message) {
      const t = await sanskrit_learning.turn(message, { agent: AGENT, sessionId: SESSION });           // 1. the user's text arrived
      const answer = 'You said: ' + message;                                                   // 2. your agent works here
      console.log('Agent:', answer);
      const r = await sanskrit_learning.speak(answer, { agent: AGENT, sessionId: SESSION, turnId: t.turnId }); // 3. final answer ready
      console.log(`  [sanskrit_learning] turn=${t.reason} reply=${r.reason}`);
    }
    if (!closed) rl.prompt();
  }
}

main();
```

Then test both kinds of message:

1. **Type** `hello` and press Enter. Expect `turn=no_match reply=not_talkback` and silence. That holds only when no talk-back draft is waiting: if you dictated with Ctrl+Shift+U and haven't sent it, the reply is `held` instead, as in the [manual test](#manual-test).
2. **Dictate**: press **Ctrl+Shift+U**, say a sentence, press **Ctrl+Shift+U** again. In Windows Terminal or a PowerShell window, SanskritLearning doesn't type for you: it puts the text on the clipboard (see the README, [Terminals](../README.md#terminals)). Paste it with **Ctrl+V** and press Enter; it still counts as the talk-back message. In the terminal panel of VS Code or Cursor, the text is pasted directly. Expect `turn=match reply=queued`, and you hear "You said: …".

If step 2 doesn't give `match` and `queued`, see [Nothing is spoken](#nothing-is-spoken).

## 4. Find the two places in your agent

The calls go in your agent's **backend**: the code that receives the user's text and sends it to the model. It is not the UI that shows the input box. In a single-process app, the backend is simply the function that handles a submitted message.

| Your agent is… | Place 1: the user's text arrives | Place 2: the final answer is ready |
|---|---|---|
| a Flask or FastAPI server | the start of the route that receives the message (`@app.post("/chat")`) | just before the route returns the answer, or after the stream ends |
| an Express server | the start of the `app.post('/chat', …)` handler | just before `res.json(...)`, or after the stream ends |
| a WebSocket server | where the message event is received (`ws.on('message', …)`, `async for message in websocket`) | after you send the last chunk of the answer |
| a command-line agent | right after `input()` / `readline` returns the line | after the answer is printed |
| a desktop app | the handler for the Send button or Enter key, once it has the text | where the final answer is shown in the conversation |

How to find them in an unfamiliar codebase:

- **Place 1**: start from the input box's submit handler, or the HTTP or WebSocket endpoint the UI calls. Follow the text until you reach the first function that has the user's message as a plain string, **before** it is merged with a system prompt, history or retrieved context. Report that string.
- **Place 2**: find where the model's output is complete: the return value of the model call or, for streaming, the point after the last chunk. Report the answer the user sees, not tool calls or intermediate steps.

Keep the turn ID from place 1 so that place 2 can pass it. In a request handler that is a local variable. Across a WebSocket or a queue, store it with the request: it is the same value as the `turnId` key in the result of `turn()`.

## 5. Add the two calls

Call `speak()` whether your agent succeeds or fails. If your agent fails and never answers, the talk-back stays waiting (see [Lifecycle and edge cases](#lifecycle-and-edge-cases)). The examples below speak a short error message instead.

Python (Flask):

```python
import sanskrit_learning

@app.post("/chat")
def chat():
    message = request.json["message"]
    conversation_id = request.json.get("conversation_id", "default")
    t = sanskrit_learning.turn(message, agent="my-agent", session_id=conversation_id)   # place 1
    answer = "Sorry, something went wrong."
    try:
        answer = run_agent(message, conversation_id)                           # your agent
        return {"answer": answer}
    finally:                                                                   # place 2, on success or failure
        sanskrit_learning.speak(answer, agent="my-agent", session_id=conversation_id, turn_id=t["turnId"])
```

Python with asyncio (FastAPI, aiohttp, websockets): the Python client is **blocking** and has no async version. Run it in a worker thread so it never holds up the event loop:

```python
import asyncio, sanskrit_learning

@app.post("/chat")
async def chat(body: ChatIn):
    t = await asyncio.to_thread(sanskrit_learning.turn, body.message, agent="my-agent", session_id=body.conversation_id)
    answer = "Sorry, something went wrong."
    try:
        answer = await run_agent(body.message)
        return {"answer": answer}
    finally:
        await asyncio.to_thread(sanskrit_learning.speak, answer, agent="my-agent",
                                session_id=body.conversation_id, turn_id=t["turnId"])
```

`asyncio.to_thread` needs Python 3.9. On 3.8, use `loop.run_in_executor(None, functools.partial(sanskrit_learning.turn, ...))`.

Node (Express). The Node client is asynchronous: `turn()` and `speak()` return promises and never block:

```js
const sanskrit_learning = require('./client.cjs');

app.post('/chat', async (req, res) => {
  const { message, conversationId = 'default' } = req.body;
  const t = await sanskrit_learning.turn(message, { agent: 'my-agent', sessionId: conversationId });   // place 1
  let answer = 'Sorry, something went wrong.';
  try {
    answer = await runAgent(message, conversationId);                                         // your agent
    res.json({ answer });
  } catch (error) {
    res.status(500).json({ error: answer });
  } finally {                                                                                 // place 2, on success or failure
    await sanskrit_learning.speak(answer, { agent: 'my-agent', sessionId: conversationId, turnId: t.turnId });
  }
});
```

**Streaming answers**: collect the chunks while you stream them to the user, then call `speak()` once with the full final text after the stream ends. Don't call `speak()` per chunk: only the first reply for a turn is spoken, and every later one is silent.

```python
answer, chunks = "Sorry, something went wrong.", []
try:
    for chunk in model.stream(message):
        send_to_user(chunk)
        chunks.append(chunk)
    answer = "".join(chunks)
finally:
    sanskrit_learning.speak(answer, agent="my-agent", session_id=conversation_id, turn_id=t["turnId"])
```

**Logging during development**: log `t["reason"]` and the result of `speak()` (`["reason"]`), as the echo agent does. Those two words tell you what happened. See [Reasons](#reasons).

## Reference

### Functions

Python (`sanskrit_learning.py`):

| Function | Returns |
|---|---|
| `turn(text, *, agent="custom", session_id="default", turn_id=None, profile=None, timeout=0.25)` | the service's result plus `"turnId"`: the ID you passed, or a new UUID |
| `speak(text, *, agent="custom", session_id="default", id=None, turn_id=None, profile=None, timeout=0.25)` | the service's result |
| `status(*, profile=None, timeout=0.25)` | the `/health` response, or `None` when SanskritLearning is not available |
| `event(data, *, agent="custom", session_id="default", profile=None, timeout=0.25)` | the service's result, for events the other functions don't cover (`detach`, `final: False`, `reply-end`) |

Node (`client.cjs`). The options use camelCase:

| Function | Returns (a promise of) |
|---|---|
| `turn(text, {agent, sessionId, turnId, profile, timeout})` | the service's result plus `turnId` |
| `speak(text, {agent, sessionId, id, turnId, profile, timeout})` | the service's result |
| `status({profile})` | the `/health` response, or `null`. It has no `timeout` option: it always uses 250 ms. |
| `event(data, {agent, sessionId, profile, timeout})` | the service's result |

The service's result is an object with `accepted` (true or false), `reason` (see [Reasons](#reasons)), sometimes `detail`, and `status` (the HTTP status code). When SanskritLearning can't be reached, it is `{"accepted": false, "reason": "unavailable"}` with no `status`. No function ever raises or rejects.

### agent and session_id

- **`agent`**: a name for your agent, 1–100 characters, for example `"my-agent"`. It doesn't need to be registered anywhere or match anything in SanskritLearning: there is nothing to connect in the tray for a custom agent. It appears in SanskritLearning's request log, so pick something recognisable. Defaults to `"custom"`.
- **`session_id`** (`sessionId` in Node): your conversation ID, at most 200 characters. Defaults to `"default"`. If your agent has no conversations, keep the default. If it has several (tabs, windows, chats), pass a different ID for each.
- `turn()` and `speak()` for the same message **must use the same `agent` and `session_id`**. SanskritLearning ties a reply to its turn by the pair `agent` + `session_id`, plus the turn ID.

### Turn IDs and reply IDs

- **Turn ID**: identifies one user message. `turn()` creates a UUID when you don't pass `turn_id`, and returns it as `"turnId"`. Pass the same value to `speak()` as `turn_id`. A reply with a missing or different turn ID doesn't get that turn's talk-back. Rules: a non-empty string of at most 200 characters. It only needs to be unique within your `agent` + `session_id`. A UUID per message is the safe choice.
- **Reply ID** (`id`): identifies one answer. `speak()` creates a new UUID on every call when you don't pass `id`. The service ignores a second reply with the same `id` for the same `agent` + `session_id`, and answers `duplicate`. So if you retry `speak()` after a failure, pass the same `id` each time. Otherwise each retry counts as a new answer.
- **Neither survives a restart of SanskritLearning.** Talk-back state and remembered reply IDs live in memory only. The service remembers the last 1,000 reply IDs.

### profile and timeout

- **`profile`**: the folder holding `endpoint.json` and `auth.json`. The default is `%LOCALAPPDATA%\SanskritLearning\resident`. Leave it unset. It is for tests, and for a process whose `LOCALAPPDATA` variable points somewhere else. Your agent must still run as the same Windows user, because only that user can read the folder.
- **`timeout`**: how long a call may take before the client gives up and answers `unavailable`. Python: `0.25` seconds, applied to connecting and to each read separately. Node: `250` milliseconds for the whole request (`status()` always uses 250 ms). The service only queues the answer and never waits for speech: on a test PC a call took 2–4 ms, and the slowest of 40 took 22 ms. 250 ms leaves a wide margin while guaranteeing that a stuck or absent SanskritLearning never slows your agent noticeably. If `status()` works but calls sometimes answer `unavailable` on a heavily loaded machine, raise it, for example to `1` second or `1000` ms.

### What gets read aloud

Send the answer exactly as the user sees it. You don't need to strip Markdown, code or links. With the default settings, SanskritLearning reads only the opening: the first paragraph, at most 3 sentences and 400 characters. It skips sentences it can't say well, such as code, file paths, URLs and JSON. "Full reply on screen." follows when something was left out, and "The reply is on screen." is said when nothing could be read, which includes an empty answer. Text limits: 60,000 characters per call, 256 KiB per request.

The full rules are in [What is spoken](DEVELOPER_GUIDE.md#what-is-spoken) and [Pronunciation](DEVELOPER_GUIDE.md#pronunciation).

### How matching works

When a `turn` arrives, SanskritLearning compares its text with the talk-back draft, after normalising both:

- letters are lowercased and Unicode-normalised (NFKC);
- every run of characters other than letters and digits (spaces, punctuation, symbols, line breaks) becomes a single space;
- a `<system-reminder>…</system-reminder>` block is removed with its contents, and `<pasted_content>` and `</pasted_content>` tags are removed, keeping the text between them. Some agents wrap the user's message this way; you don't need to strip them yourself.

The turn **matches** when the normalised texts are at least **75% similar** (character edit distance, compared on the first 4,000 characters), or when the turn contains the whole draft and the draft is at least **60%** of the turn's length.

| The draft was "What is two plus two" and the turn's text is… | Result |
|---|---|
| `what is two plus two?` | match: case and punctuation don't count |
| `  WHAT IS TWO, PLUS TWO!!  ` | match: spaces don't count either |
| `User: What is two plus two` | match: a short prefix is fine |
| `What is 2 plus 2` | no match: 70% similar |
| the message inside a long system prompt and history | no match: report the user's message alone |

If your UI trims, re-wraps or lightly edits the text, it still matches. If your backend adds a template around the message, call `turn()` with the message alone, before the template is applied.

### Lifecycle and edge cases

There is **one talk-back for the whole PC** at a time: either a draft waiting for its turn, or a matched turn waiting for its answer.

| Situation | What happens |
|---|---|
| The answer arrives with the matching turn ID | It is spoken (`queued`). The talk-back is used up. |
| More than one reply for the turn | The first is spoken, every later one gets `not_talkback`. Send only the final answer. |
| No reply at all (your agent failed) | The talk-back stays pending until the next talk-back dictation, Ctrl+Shift+Y, the [cap](#hotkeys-tray-modes-and-the-cap), or a `detach` for that session. Either speak a short error message as the answer, or send `detach` to release it. |
| A new message arrives before the previous one is answered | A message that doesn't match changes nothing: the earlier turn keeps the talk-back, and its answer is still spoken when it arrives. A new talk-back message that matches takes over, and the earlier answer becomes silent. |
| The user dictated with Ctrl+Shift+U but hasn't sent it, and sends a different message | That turn gets `no_match`, and the draft keeps waiting. While a draft waits and no turn owns the talk-back, every reply is held for 2 seconds (`held`), whatever its turn ID. It is spoken only if a turn matching the draft arrives in that time, for the same `agent` and `session_id` (and the same turn ID, when both have one). Otherwise it stays silent, logged as `held_expired`. |
| The user presses Ctrl+Shift+Y while your agent works | The talk-back is cancelled and any speech stops. The answer gets `not_talkback`. |
| The answer arrives before its turn (both sent in parallel) | If a draft is waiting, the answer is held for 2 seconds (`held`). It is spoken if its matching turn arrives in that time. |
| SanskritLearning restarts between the turn and the answer | The talk-back is lost. The answer gets `not_talkback`. |
| A conversation closes | Optionally send `detach`: `sanskrit_learning.event({"event": "detach"}, agent="my-agent", session_id=conversation_id)`. That clears a matched turn for that session. It doesn't clear a draft that hasn't matched yet. |

**Two agents, or two windows of one agent.** The talk-back goes to whichever agent reports the matching text first. A newer talk-back dictation replaces a draft that hasn't matched yet, and a newer matching turn replaces an earlier one, whose answer then stays silent. For two windows of the same agent, give each window its own `session_id` and always pass turn IDs. If both windows share a `session_id` and you send turns without turn IDs, the first reply from either window would be spoken.

**Agents that report several messages per turn.** If your agent produces in-between messages before its final answer and you can't tell which is final until the turn ends, send each as a reply with `"final": false` through `event()`. Then send `{"event": "reply-end", "turnId": …, "status": "completed"}` when the turn ends. SanskritLearning speaks the last one. See the [HTTP API](#http-api).

```python
import uuid, sanskrit_learning

t = sanskrit_learning.turn(message, agent="my-agent", session_id=conversation_id)
for text in in_between_messages:            # each message as your agent produces it
    sanskrit_learning.event({"event": "reply", "text": text, "id": str(uuid.uuid4()),
                  "turnId": t["turnId"], "final": False},
                 agent="my-agent", session_id=conversation_id)              # reason: candidate
sanskrit_learning.event({"event": "reply-end", "turnId": t["turnId"], "status": "completed"},
             agent="my-agent", session_id=conversation_id)                  # judged like speak()
```

`event()` doesn't create a reply `id` the way `speak()` does, so pass one with each message.

### Agents that do their own speech-to-text

Talk-back starts only with SanskritLearning's own dictation (Ctrl+Shift+U). SanskritLearning can't tell that a message your agent transcribed from its own microphone was spoken, so those answers are never read aloud. If your agent has its own speech input, the user can still dictate with Ctrl+Shift+U into your agent's text box, and that message's answer is spoken.

### Hotkeys, tray modes and the cap

| Hotkey | Effect |
|---|---|
| Ctrl+Shift+I | Plain dictation. Pastes the text. Never makes an answer spoken, and leaves a waiting talk-back as it is. |
| Ctrl+Shift+U | Talk-back dictation. Pastes the text and makes it the talk-back draft, replacing an older one. The draft is kept even if the paste falls back to the clipboard. |
| Ctrl+Shift+Y | Cancel, at any time. Discards a recording in progress, so nothing is pasted. Clears the draft and the matched turn, and stops speech. It never erases text already in your agent's input box: the only keystroke SanskritLearning sends to a box is the Ctrl+V of a paste. |

The keys can be changed in `settings.json` (`hotkeys`). The full behaviour of each key is under [Hotkeys](DEVELOPER_GUIDE.md#hotkeys) in the developer guide.

- **Tray → read-aloud mode.** **Talk-back only** (the default) or **Off**. With Off, turns still match, but the answer gets `disabled` and uses up the talk-back.
- **Tray → Pause hotkeys.** While paused, every call answers `paused`.
- **The cap.** A draft or matched turn that is never used is cleared after 2 hours (`talkbackCapMs` in `settings.json`, 10 minutes to 24 hours). Each clearing is logged (see [Logs](#logs)).

### HTTP API

For agents in other languages. The service listens on `127.0.0.1` on a port chosen at each start.

**Discovery.** Two files in `%LOCALAPPDATA%\SanskritLearning\resident\`:

```text
endpoint.json   {"pid": 1234, "port": 52151, "version": "0.8.0"}   written while the service runs, removed when it stops normally
auth.json       {"token": "<64 lowercase hex characters>"}          created at install
```

- Read both files **on every call**, or at least again after any failure. The port changes at each start.
- If either file is missing or unreadable, SanskritLearning isn't installed or isn't running: skip the call silently.
- The token stays the same until SanskritLearning is uninstalled and installed again. The folder is readable only by the current Windows user. Never copy the token into source code, config files, logs, prompts or a browser.

**Endpoints.**

| Method and path | Purpose |
|---|---|
| `POST /event` | report a turn, a reply, `reply-end` or `detach` |
| `GET /health` | service state (the response shown in [step 2](#2-check-that-sanskritlearning-is-running)) |
| `GET /requests` | the last 100 entries of the request log since the service started |

**Headers** (on every request):

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token from auth.json>` |
| `Host` | exactly `127.0.0.1:<port>`. `localhost:<port>` is rejected. |
| `Content-Type` | `application/json` for `POST`. The clients send it; the service doesn't require it. |
| `Origin`, `Sec-Fetch-*` | **must be absent**. They, and any `OPTIONS` request, are rejected: browsers can't call SanskritLearning. |

**Body of `POST /event`**: a JSON object of at most 256 KiB, sent as UTF-8.

| Field | Events | Required | Meaning |
|---|---|---|---|
| `event` | all | yes | `"turn"`, `"reply"`, `"reply-end"` or `"detach"` |
| `agent` | all | yes | 1–100 characters |
| `sessionId` | all | yes | at most 200 characters |
| `text` | `turn`, `reply` | yes | the user's message, or the answer. At most 60,000 characters. Never logged or stored. |
| `turnId` | `turn`, `reply`, `reply-end` | recommended | a non-empty string of at most 200 characters |
| `id` | `reply` | **yes** | a non-empty string of at most 200 characters, unique per answer |
| `final` | `reply` | no | `false` marks an in-between message (a candidate). The latest candidate per `sessionId` and `turnId` is kept until `reply-end`. |
| `status` | `reply-end` | no | `"completed"` judges the last candidate as the answer. Any other value discards it. |

Example (Windows PowerShell). The first line matters: Windows PowerShell 5.1 sends text piped to a program like `curl.exe` as ASCII by default. Without it, `café` would arrive as `caf?` and the turn might not match.

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)   # send UTF-8; Windows PowerShell 5.1 sends ASCII by default
$dir = "$env:LOCALAPPDATA\SanskritLearning\resident"
$port = (Get-Content "$dir\endpoint.json" | ConvertFrom-Json).port
$token = (Get-Content "$dir\auth.json" | ConvertFrom-Json).token
$turnId = [guid]::NewGuid().ToString()
$turn = @{event='turn'; text='How should I train this week?'; turnId=$turnId; agent='my-agent'; sessionId='default'} | ConvertTo-Json -Compress
$turn | curl.exe -s -m 1 -X POST "http://127.0.0.1:$port/event" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary '@-'
$reply = @{event='reply'; text='Do 3 sets (RPE 8) on push/pull days.'; id=[guid]::NewGuid().ToString(); turnId=$turnId; agent='my-agent'; sessionId='default'} | ConvertTo-Json -Compress
$reply | curl.exe -s -m 1 -X POST "http://127.0.0.1:$port/event" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary '@-'
```

Every response is JSON: `{"accepted": <bool>, "reason": "<code>"}`, sometimes with `detail`. The codes are listed under [Reasons](#reasons).

### Reasons

**From `turn()`:**

| Status | `accepted` | `reason` | Meaning | What to do |
|---|---|---|---|---|
| 200 | true | `match` | This message matched the talk-back draft. Its answer will be spoken. | Pass the turn ID to `speak()`. |
| 200 | true | `no_match` | No talk-back for this message: typed, plain dictation, or the text didn't match. | Nothing, unless you expected a match. See [Nothing is spoken](#nothing-is-spoken). |

**From `speak()`:**

| Status | `accepted` | `reason` | Meaning | What to do |
|---|---|---|---|---|
| 202 | true | `queued` | It will be spoken, after any earlier answers. | Nothing. |
| 202 | true | `held` | No turn owns the talk-back yet, but a talk-back draft is waiting: the user dictated with Ctrl+Shift+U and hasn't sent it, or its turn hasn't arrived yet. Every reply that isn't owned is held for 2 seconds, whatever its turn ID. It is spoken if a turn matching the draft arrives in that time for the same `agent` and `session_id` (and the same turn ID, when both have one). | Nothing. If it is never spoken, the request log shows `held_expired`. If you expected it to be spoken, send the turn before the reply. |
| 200 | false | `not_talkback` | This answer's turn doesn't own the talk-back. | Normal for typed messages. Otherwise check the turn ID, `agent` and `session_id`. |
| 200 | false | `disabled` | The tray's read-aloud mode is Off. | The user switches it back to Talk-back only. |
| 200 | false | `duplicate` | This `id` was already received for this `agent` + `session_id`. | Pass a new `id` for a new answer. |
| 200 | false | `queue_full` | 100 answers are already waiting to be spoken. | Rare. Send fewer replies. |
| 200 | false | `display_only` | Only when the user set `spokenSentences` and `spokenChars` to `0` (read the whole answer): nothing in it can be spoken. `detail` is `code`, `diff`, `path`, `url`, `json`, `too_long` or `empty`. | Nothing. The answer is on screen. |

`held_expired` and `held_released` are never responses. They appear only in `requests.jsonl`, as the `detail` of a later entry for the held reply. `held_expired` is logged with reason `not_talkback`: the held answer's matching turn didn't arrive within 2 seconds, so it stayed silent. `held_released` is logged when that turn arrived, with the reason the answer then got, normally `queued`.

**From `event()` with `"final": false`, `reply-end` or `detach`:**

| Status | `accepted` | `reason` | Meaning |
|---|---|---|---|
| 202 | true | `candidate` | A reply with `"final": false` was stored until `reply-end`. Uncommitted candidates are dropped after 30 minutes. |
| 200 | true | `no_candidate` | `reply-end` with no candidate stored, whatever its `status`. A candidate arriving within 2 seconds still counts as the final answer. |
| 200 | true | `discarded` | `reply-end` with a `status` other than `completed`, and a candidate waiting. `detail` is the status. |
| 200 | true | `recorded` | `detach` was applied. |

**From any call:**

| Status | `accepted` | `reason` | Meaning | What to do |
|---|---|---|---|---|
| none | false | `unavailable` | Returned by the client: SanskritLearning isn't running, or didn't answer within the timeout. | Start SanskritLearning. See [profile and timeout](#profile-and-timeout). |
| 200 | false | `paused` | The user chose Pause hotkeys in the tray. Turns are not matched while paused. | The user un-pauses. |
| 400 | false | `missing_id` | A reply without an `id`, or with an empty one. | Pass an `id`, or let `speak()` create one. |
| 400 | false | `invalid_id`, `invalid_turn_id` | `id` or `turnId` isn't a non-empty string of at most 200 characters. | Fix the value. |
| 400 | false | `invalid_text` | `text` isn't a string, or is longer than 60,000 characters. | Send a string, and shorten it. |
| 400 | false | `invalid_identity` | `agent` or `sessionId` is missing, the wrong type or too long. | Fix the value. |
| 400 | false | `unknown_event` | `event` isn't one of the supported values. | Fix the value. |
| 400 | false | `invalid_json`, `too_large` | The body isn't JSON, or is larger than 256 KiB. | Fix the body. |
| 400 | false | `invalid_request` | Any other malformed request. | Check the body against the HTTP API. |
| 403 | false | `browser_request` | An `Origin` or `Sec-Fetch-*` header was sent, or the method was `OPTIONS`. | Call from your backend, never from a browser. |
| 403 | false | `bad_host` | The `Host` header isn't exactly `127.0.0.1:<port>`. | Connect to `127.0.0.1`, not `localhost`. |
| 403 | false | `unauthorized` | The token is missing or wrong. | Read `auth.json` again. |
| 404 | false | `not_found` | Wrong method or path. | Use `POST /event`, `GET /health` or `GET /requests`. |

### Logs

- **`%LOCALAPPDATA%\SanskritLearning\resident\requests.jsonl`**: one line per request, with the time, route, event, `agent`, session, turn ID, status, `accepted`, `reason`, and the decision. It never contains the message or answer text, reply IDs or the token. When the file passes 256 KiB, it is renamed to `requests.1.jsonl` and a new one is started.
  - When a turn doesn't match a waiting draft, its line includes `"match": {"similarity": …, "draftChars": …, "promptChars": …, "contained": …}`. That's the similarity, the two normalised lengths, and whether the turn contains the whole draft. It's the quickest way to see why a message didn't match.
  - When the cap clears a forgotten talk-back, a line `{"route": "talkback", "event": "cap_cleared", "detail": "dictation" or "turn", "ageMs": …}` is added.
- **`GET /requests`**: the last 100 of those entries since the service started.
- **`resident-error.log`** in the same folder: errors from the service itself.

### Nothing is spoken

Work through this list in order. Every call's `reason` and the `talkback` field of `status()` point to the cause.

1. **SanskritLearning isn't running.** Calls answer `unavailable`, and `status()` returns `None`/`null`. Start it from Start → SanskritLearning.
2. **The tray is set to Off.** `readMode` is `"off"`, and replies answer `disabled`.
3. **Hotkeys are paused.** Every call answers `paused`.
4. **Ctrl+Shift+I was used instead of Ctrl+Shift+U.** The turn answers `no_match`, and `status()` showed `talkback: "none"` before the turn.
5. **The text doesn't match.** The turn answers `no_match` while `status()` shows `talkback: "dictation"`. The request log line shows the similarity: report the user's message alone, not the full prompt (see [How matching works](#how-matching-works)).
6. **`turn()` is never called, or is called after `speak()`.** The reply answers `not_talkback`, or `held` and later `held_expired` in the log.
7. **The reply has a different turn ID, `agent` or `session_id` from the turn.** The turn answers `match` but the reply answers `not_talkback`.
8. **A newer talk-back, Ctrl+Shift+Y, `detach` or a SanskritLearning restart cleared it.** The reply answers `not_talkback`.
9. **The cap expired.** The log has a `cap_cleared` line.
10. **The reply answers `queued` but nothing is heard.** It's a sound problem, not an integration one. Check the speakers, the volume and the default playback device. The tray's **Diagnose…** checks that the speech models are present.

## Manual test

| What the user does | `turn()` | `speak()` | Heard |
|---|---|---|---|
| Types a message, with no talk-back draft waiting | `no_match` | `not_talkback` | no |
| Dictates with Ctrl+Shift+I | `no_match` | `not_talkback` | no |
| Dictates with Ctrl+Shift+U and sends it | `match` | `queued` | yes, once |
| Dictates with Ctrl+Shift+U without sending, then types and sends a different message | `no_match` | `held`, then `held_expired` in the log | no |
| Dictates with Ctrl+Shift+U, presses Ctrl+Shift+Y, then sends | `no_match` | `not_talkback` | no |
| Dictates with Ctrl+Shift+U, sends, presses Ctrl+Shift+Y while the agent works | `match` | `not_talkback` | no |
| Tray set to Off, dictates with Ctrl+Shift+U and sends | `match` | `disabled` | no |

## FAQ

**Can my agent speak without the user dictating?** No. SanskritLearning only speaks the answer to a message the user dictated with Ctrl+Shift+U, and has no mode or call that speaks every answer. This is deliberate: an agent can never start talking unless the user asked by voice.

**Does it work with a cloud-hosted backend?** Only for the part of your app that runs on the user's PC. The calls must come from a process on the same PC, signed in as the same Windows user: the service listens only on `127.0.0.1`, the token is readable only by that user, and requests from browsers are refused. If your agent's backend runs in the cloud, make the calls from its local part, such as a desktop app, a command-line client or a local server, when it sends the message and when it receives the final answer.

**Can I choose the voice?** Not at the moment. SanskritLearning uses one fixed Kokoro voice for all agents.

**How do I turn the integration off without removing the code?** In your own code, skip the two calls behind a flag of your choice. They are optional for your agent, which works the same without them. For the user, the tray's **Off** mode silences every agent, and quitting SanskritLearning makes every call answer `unavailable` until it starts again.
