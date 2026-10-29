# Supported agents

SanskritLearning reads a reply aloud only when its prompt was dictated with talk-back (Ctrl+Shift+U). To decide, the service needs two events from the agent: the **turn** (the prompt text, for matching) and the **reply** (the final answer). Agents with lifecycle hooks send both with no agent code. One shared program, [`src/adapters/hooks/adapter.cjs`](../src/adapters/hooks/adapter.cjs), does this for every agent; a small mapping file per agent names its events and payload fields.

Dictation (Ctrl+Shift+I and U) pastes into any focused input box, so it works with every agent's app and editor panel. Terminal windows are deliberately excluded: for an agent CLI (Claude Code, Codex, `agy`, Gemini, Continue or Cline) running in Windows Terminal, PowerShell or Command Prompt, the dictated text is copied to the clipboard instead, so it never lands in a terminal prompt unchecked. In the terminal panels of VS Code and Cursor it is pasted directly (see [Terminals](../README.md#terminals)). Talk-back still works there: dictate with Ctrl+Shift+U, paste, and send. Cancel (Ctrl+Shift+Y) acts in the service, so it works everywhere too. Only talk-back depends on the hooks below.

Agents with their own backend use the HTTP contract in the [Custom agents reference](CUSTOM_AGENTS_REFERENCE.md#http-api) instead.

## Supported agents

"Tested live" means a real agent ran the installed hook and its reply was spoken. "Sample payloads" means the mapping is tested against payloads taken from the agent's documentation or source.

| Agent | Mechanism | Install / uninstall | Dictation | Talk-back | Cancel | Tested | Known gaps |
|---|---|---|---|---|---|---|---|
| Claude Code (terminal, VS Code extension) | Plugin hooks: UserPromptSubmit, Stop (async), SessionEnd | `install claude-code` / `uninstall claude-code` | Yes | Yes | Yes | **Tested live** | No turn id, so ownership is per session. |
| Codex: VS Code extension, ChatGPT desktop app (Codex), CLI | `~/.codex/hooks.json`: UserPromptSubmit (async), Stop (async), SessionEnd | `install codex` / `uninstall codex`, then trust the hooks once | Yes | Yes | Yes | **Tested live** | A new or changed hook is skipped until trusted. Codex cloud tasks run on OpenAI's machines and are out of scope. |
| Antigravity (2.0 app, IDE, `agy` CLI) | `~/.gemini/config/hooks.json`: Stop, plus the transcript file it names | `install antigravity` / `uninstall antigravity` | Yes | Yes | Yes | **Tested live** | Hooks carry no text, so the turn is reported only when the task ends. A talk-back task longer than the 2-hour cap is silent. |
| Cursor (IDE) | `~/.cursor/hooks.json`: beforeSubmitPrompt, afterAgentResponse (candidates), stop (commit), sessionEnd | `install cursor` / `uninstall cursor` | Yes | Yes | Yes | **Tested live** | Only the last assistant message of a completed turn is spoken. Messages queued mid-task skip hooks (a Cursor bug). Cursor lists hooks under paid plans; whether the free plan runs them is unverified. |
| Codex `notify` (fallback) | `notify = [...]` in `~/.codex/config.toml` | **Never installed** (Codex has one notify slot, often used by something else) | Yes | Yes, if set by hand | Yes | Sample payloads | One slot only; the turn is reported when the turn ends. |
| Gemini CLI | `~/.gemini/settings.json`: BeforeAgent, AfterAgent, SessionEnd | `install gemini` / `uninstall gemini` | Clipboard in terminal windows; pasted in VS Code or Cursor terminal panels | Yes | Yes | Sample payloads | Not used by Antigravity. Stdout must be JSON, so the hook prints `{}`. |
| Windsurf | `~/.codeium/windsurf/hooks.json`: pre_user_prompt, post_cascade_response_with_transcript | `install windsurf` / `uninstall windsurf` | Yes | Yes | Yes | Sample payloads | The reply is read from the transcript; that line shape is documented but unseen. Hooks don't run in Restricted Mode. |
| Cline (VS Code extension, CLI) | One PowerShell script per hook in `~/Documents/Cline/Hooks`: UserPromptSubmit, TaskComplete, TaskCancel | `install cline` / `uninstall cline` | Yes | Yes | Yes | Sample payloads | TaskComplete may fire only when a whole task completes. A redirected Documents folder (OneDrive) is unverified. If a `TaskComplete.ps1` of your own already exists, install stops. |
| Continue CLI (`cn`) | `~/.continue/settings.json`: UserPromptSubmit, Stop, SessionEnd | `install continue` / `uninstall continue` | Clipboard in terminal windows; pasted in VS Code or Cursor terminal panels | Yes | Yes | Sample payloads | Source only, no docs page. The Continue VS Code extension doesn't use these hooks. |
| Goose | Plugin folder `~/.agents/plugins/sanskrit_learning`: UserPromptSubmit, Stop | `install goose` / `uninstall goose` | Yes | Yes | Yes | Sample payloads | Goose runs hooks with `sh -c` even on Windows, so `sh` (Git for Windows) must be on PATH; install checks for it. |

Users connect and disconnect agents from the tray menu → **Connect agents…** (or when setup offers it); uninstall disconnects every agent. Both run the installers described below. From a checkout, the same installers run as `node scripts/agent-hooks.cjs <install|uninstall|status> <agent>`. `uninstall all` and `status all` cover every agent. `--dry-run` prints the change without writing it.

**Not supported yet** (see the [roadmap](ROADMAP.md)): GitHub Copilot CLI and VS Code agent mode, OpenCode, Kilo Code, Amp, Aider, the Zed agent panel, and apps without hooks such as Claude Desktop and web chats.

## What install changes

- **One command each way.** Install and uninstall never require reinstalling, updating or reconfiguring the agent.
- **Only our entries.** Our entries are the hooks whose command runs `src/adapters/hooks/adapter.cjs`. Every other key and hook in the file is kept.
- **Checked first.** Before writing anything, the installer looks for the agent. If it isn't found, or its version lacks the hook support needed, the installer says so and stops with nothing changed.
- **Backed up.** The first install saves the existing file beside it as `<file>.sanskrit_learning.bak`. A reinstall keeps that first backup.
- **Uninstall restores.** It removes our hooks and checks the result against the backup. A file that SanskritLearning created is deleted. Codex's trust entries for our hooks are removed from `~/.codex/config.toml`; its `notify` entry is never touched.
- **Invalid JSON** in the agent's file: the command stops and changes nothing.

| Agent | How the installer checks support |
|---|---|
| codex | Finds `codex.exe` (the Codex app's `%LOCALAPPDATA%\OpenAI\Codex\bin`, the npm package, or PATH) and checks that it contains `last_assistant_message`. An npm launcher script can't be checked, so it is accepted and reported as unverified. |
| cursor | Finds Cursor and checks that its agent code contains `afterAgentResponse`. |
| antigravity | Finds the language server of the app or IDE, or `agy`, and checks that it contains `transcriptPath`. |
| claude-code | Uses the `claude` CLI's own plugin commands: `claude plugin marketplace add`, `claude plugin install`, and on uninstall `claude plugin uninstall` and `claude plugin marketplace remove`. Uninstall also removes the plugin's cache and its entries in Claude's settings. |

The installed command is `node <folder>/src/adapters/hooks/adapter.cjs <agent>` (Antigravity adds the event name). It is **never quoted**, because agents start it in incompatible ways: Antigravity splits it on spaces with no shell, Codex passes it to PowerShell `-Command` or `cmd.exe /C`, and others use `sh`. In an installation made by setup, `node` is the full path of SanskritLearning's own runtime (`%LOCALAPPDATA%\SanskritLearning\runtime\node\node.exe`), so no Node.js is needed on PATH; Claude Code's plugin hooks get the same path. A path with spaces uses its 8.3 short name; if there is none, install stops with nothing changed. In a development checkout, `node` on PATH is used, and moving the folder needs a reinstall.

## Status in the Connect agents window

| Status | Meaning |
|---|---|
| Not installed | The agent was not found on this PC (same check as install). |
| Installed – not connected | Found, no SanskritLearning hook. |
| Connected | The hook is installed and points at this installation. |
| Connected – needs restart | Connected while the agent was running (a process of it started before the connection), and no hook call has been logged since. Restart it to load the hook. The first hook call clears this: Claude Code, for example, loads a newly installed plugin into sessions that are already open. |
| Needs action | A step in the agent itself: Codex hooks not yet trusted, Claude Code plugin disabled, or a hook pointing at another SanskritLearning folder (click Connect to repair). |

Connections are recorded with their time in `%LOCALAPPDATA%\SanskritLearning\resident\connections.json`.

## Never delaying or breaking the agent

- The hook always exits 0, and prints nothing except an acknowledgement an agent requires (`{"continue":true}` for Cursor's beforeSubmitPrompt, `{}` for Antigravity and Gemini).
- It acts on the first complete JSON object on stdin and never waits for end of input, because some agents leave stdin open. It exits 1.5 s after starting, whatever happens. Each call to the service has a 250 ms deadline.
- A missing service, bad JSON or an unknown agent is silently ignored.
- Hooks run in the background wherever the agent allows it (Claude Code Stop, Codex UserPromptSubmit and Stop).
- A reply can arrive before its turn when both hooks run in the background. While a talk-back is waiting, the service holds an unmatched reply for up to 2 s for its late turn.

## Agent notes

### Claude Code
- UserPromptSubmit carries `prompt`, Stop carries `last_assistant_message`, both carry `session_id`.
- All three hooks run `plugin/hook-launcher.cjs` with Node (the bundled runtime in an installation). Claude runs it from its plugin cache; it finds this folder through the registered marketplace (or `SANSKRIT_LEARNING_INSTALL_ROOT`) and hands the payload to `hook.cjs`.

### Codex
- The ChatGPT desktop app, the VS Code extension and the CLI each run `codex.exe app-server`, which runs the hooks from `~/.codex/hooks.json`.
- **Trust:** a hook runs only once it is trusted. Trust is a per-hook hash saved in `~/.codex/config.toml`, shared by every Codex surface. In the app or extension: **Settings → Hooks → Trust all**. In the CLI: the "Hooks need review" prompt, or `/hooks`, then `t`. An untrusted hook is skipped silently. Moving the folder changes the command, so the hooks need trusting again.
- Async hooks don't appear in Codex's hook run history; check `hooks.jsonl` instead.
- Steered messages each fire UserPromptSubmit with the running turn's `turn_id`. One that matches the talk-back owns it, and the Stop reply with that `turn_id` is spoken.

### Cursor
- User hooks in `~/.cursor/hooks.json` load automatically, with no approval step. They appear under **Customize → Hooks**; runs and errors are in **View → Output → Hooks**.
- On Windows, Cursor pipes the payload through Windows PowerShell 5.1, which adds a byte-order mark and mis-decodes non-ASCII text. The mapping repairs the text (`repairEncoding: "cp1252"`). Installing PowerShell 7 avoids it.
- `afterAgentResponse` fires for every assistant message, including in-between ones. Each is sent as a candidate, and `stop` commits the last one of a completed turn. An aborted turn is discarded.
- Cursor also runs Claude Code hooks ("third-party extensibility", on by default). Those payloads carry `cursor_version`, and the `claude-code` mapping skips them, so Cursor's own hook owns the turn.

### Antigravity
- Antigravity has its own hook system (not Gemini CLI's): `~/.gemini/config/hooks.json`, events PreToolUse, PostToolUse, PreInvocation, PostInvocation and Stop. No event carries the prompt or reply text.
- On Stop, the adapter reads the transcript the hook names (`transcript_full.jsonl`): the prompts since the last final answer, and the last planner response with no tool calls.
- Hooks run without a shell and with `~/.gemini/config` as the working directory. Failures are logged in Antigravity's `language_server.log`.

## Logs

Each mapped hook call appends one line to `%LOCALAPPDATA%\SanskritLearning\resident\hooks.jsonl` (moved to `hooks.1.jsonl` at 256 KiB): the agent, the event, the kind (`turn`, `reply`, `detach`), the payload field names found, any `missing` required fields, and the service's result reasons. An event the mapping doesn't know is logged with `kind: null`. Lines never contain prompt or reply text.

```json
{"harness":"claude-code","event":"Stop","kind":"reply","found":{"event":"hook_event_name","session":"session_id","reply":"last_assistant_message"},"results":["not_talkback"]}
```

To add an agent, see [Adding an agent](DEVELOPER_GUIDE.md#adding-an-agent).
