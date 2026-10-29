# SanskritLearning

A Sanskrit pronunciation tutor for Windows, built on offline dictation with spoken replies from Claude Code.

You speak a Sanskrit line; a Sanskrit speech recogniser writes down exactly what it heard, mistakes included; Claude compares it with the line, akshara by akshara, explains what to fix in plain English, and the correct Sanskrit is read back to you in a natural Sanskrit voice. Everything runs on your PC.

## Sanskrit tutor

1. Install (see [Install](#install)) and connect Claude Code when setup asks.
2. Open Claude Code in the `tutor` folder of this repository (it holds the tutor's instructions, `tutor/CLAUDE.md`) and say hello.
3. Claude gives you a line and reads it aloud. Press **Ctrl+Shift+U**, say the line, press **Ctrl+Shift+U** again, and send the pasted text. Claude checks the take and answers aloud: what to fix, then the correct Sanskrit.

How it works:

- **Hearing you:** Su-śrotā (IISc Bengaluru), a recogniser trained on Sanskrit recitation, decodes each take three ways. A slip heard in all three is a mistake; one heard in only some is "unclear" and never counted against you. Every take is saved in `%LOCALAPPDATA%\SanskritLearning\resident\takes`; `tutor/check.cjs` compares the latest one with the target line.
- **Speaking to you:** Devanagari in a reply is read by Indic Parler-TTS (AI4Bharat, speaker "Aryan"), everything else by Kokoro in English. `"sanskritVoice": "vagdhenu"` in settings.json switches the Sanskrit voice to Vāgdhenu (IISc), which chants verse in metre (its models are not downloaded by setup: run `node scripts/sanskrit.cjs say "<line>"` once from a checkout after downloading them; see `src/sanskrit/tts.cjs`).
- **Ordinary dictation:** the hotkeys dictate Sanskrit. `"language": "en"` in settings.json switches back to English dictation (Parakeet).
- **Practising without Claude:** `node scripts/sanskrit.cjs check "<Devanagari line>"` records one take from the microphone (Enter to start and stop) and prints the comparison.

The rest of this page describes the dictation app the tutor runs on.

- **Dictate anywhere.** Press a hotkey, speak, press again: the text is pasted into the box you were typing in. It is never sent with Enter, so you review it first. Terminals are the exception: there the text is copied to the clipboard instead (see [Terminals](#terminals)).
- **Talk-back.** Dictate with the talk-back hotkey and the agent's reply to that message is read aloud. Everything else stays silent.
- **Private.** Speech recognition and speech synthesis run on your PC. No audio or text leaves it.

Works with Claude Code, Codex, Cursor, Antigravity and other agents with lifecycle hooks (see [Supported agents](docs/SUPPORTED_AGENTS.md)), and with your own agent through a small HTTP call (see [Custom agents](docs/CUSTOM_AGENTS.md)).

## Requirements

- Windows 10 (version 1809 or later) or Windows 11, 64-bit.
- About 8 GB of free disk space during setup (3.9 GB once installed), and about 1.5 GB of memory while dictating; the Sanskrit voice adds about 5 GB while it is loaded, so 16 GB of memory is recommended. The models unload after 15 minutes without use.
- The Sanskrit voice is slow on a CPU: about 15 seconds for a two-second phrase on an Intel i5-13420H. A line it has said before is replayed at once.
- A microphone and speakers, and an internet connection for setup.

Nothing else: setup brings its own copy of Node.js. You don't need administrator rights, and setup changes no Windows security or firewall settings.

**Smart App Control.** SanskritLearning is not code-signed yet. On PCs where Windows' Smart App Control is turned on (Windows Security → App & browser control), Windows decides by reputation whether to let unsigned program files run, and it may block one of the speech engine's files. If that happens, the tray menu → **Diagnose…** names the blocked file. SanskritLearning never changes this setting for you.

## Install

1. Download this folder (for example **Code → Download ZIP** and unzip it) and open it.
2. Click the address bar of the folder window, type `powershell` and press Enter. A PowerShell window opens in the folder.
3. Run:
   ```powershell
   .\setup.cmd
   ```

Setup takes a few minutes. It:

- checks the PC and says plainly if something is missing;
- installs an official, signed Node.js for SanskritLearning's own use;
- downloads the speech models (about 3.8 GB: English dictation and voice, the Sanskrit recogniser and the Sanskrit voice) from their official sources and checks every file against the SHA-256 checksums in [`assets/live-models.json`](assets/live-models.json). If the download is interrupted, run `.\setup.cmd` again and it carries on where it stopped;
- installs SanskritLearning into `%LOCALAPPDATA%\SanskritLearning`, starts it, and starts it at every sign-in. **SanskritLearning** appears in the Start menu and in **Settings → Apps**;
- finds the coding agents on the PC and offers to connect each one.

If you start setup from a terminal inside another app (for example a coding agent's built-in terminal), it may continue in a new PowerShell window: some apps give their terminal a private copy of AppData, and SanskritLearning installed there could not start with Windows. The new window installs it normally. Its log is `%TEMP%\sanskrit_learning-setup.log`.

After setup you can delete the downloaded folder. Running setup again is safe: it repairs or updates the installation and never duplicates anything.

If setup stops partway (a lost connection, a closed window, a full disk), nothing is left half-updated. Each part (the uninstaller, Node.js, the app, its libraries) is prepared beside the installation and swapped in whole, so it is either as it was or completely new. Until setup finishes, SanskritLearning does not start; at sign-in it says that setup did not finish. Run `.\setup.cmd` again to complete it, or uninstall it: the uninstaller and its **Settings → Apps** entry are put in place first, so even an unfinished installation can be removed.

A SanskritLearning icon appears in the taskbar tray. Windows may put it under the **^** arrow; you can drag it onto the taskbar.

## Use

Click into any text box, in any app, then:

| Hotkey | What it does |
|---|---|
| **Ctrl+Shift+I** | **Dictate.** Press, wait for the beep and the red badge, speak, press again. The text is pasted into the box. |
| **Ctrl+Shift+U** | **Dictate with talk-back.** The same, with a purple badge. When you send that message to a connected agent, its reply is read aloud once. |
| **Ctrl+Shift+Y** | **Cancel.** Discards a recording in progress, cancels a pending talk-back, and stops speech. |

- A small badge near the pointer shows what is happening: Starting…, Dictating, Talk-back, Transcribing, Pasted.
- If you click away while recording, the badge warns you. If the text can't be pasted into the same box, it is copied to the clipboard instead, and a notification tells you.
- The first dictation after start-up, or after 15 idle minutes, takes longer while the models load.
- Only the opening of a reply is read: its first paragraph, up to 3 sentences. Code, file paths, links and JSON are never read out.

**Tray menu** (click the icon): read-aloud mode (**Talk-back only** or **Off**), **Status badge near pointer**, **Pause hotkeys**, **Connect agents…**, **Diagnose…**, **Uninstall SanskritLearning…** and **Quit SanskritLearning**. After quitting, start it again from **Start → SanskritLearning**.

### Terminals

SanskritLearning does not type into terminal windows. In Windows Terminal, PowerShell and Command Prompt windows, the dictated text is copied to the clipboard instead, with a notification; check it and paste it with **Ctrl+V**. This applies to agents that run there too, such as the Claude Code, Codex or Gemini CLI. Dictation never lands in a shell command or an agent's terminal prompt by surprise.

The terminal panels inside VS Code and Cursor are different: SanskritLearning pastes there directly, so dictating to an agent CLI in those panels works like any other box. The text is never sent with Enter. Those panels don't let SanskritLearning read their text back to confirm the paste, so it keeps the text on the clipboard as a backup; if the badge says **Pasted** but nothing arrived, press **Ctrl+V**.

To dictate to an agent, use its app or its chat panel in the editor (the Claude app, the Codex app, Cursor's or VS Code's agent panel). Dictation pastes there directly.

## Connect your agents

Dictation works in every app with no setup. Talk-back needs a small hook in each agent, so that SanskritLearning can see which message was dictated and what the reply was.

Open the tray menu → **Connect agents…**. The window lists the supported agents and shows each one as:

- **Not installed**, or **Installed – not connected**: click **Connect**.
- **Connected**: talk-back works. **Disconnect** removes the hook and puts the agent's settings back as they were.
- **Connected – needs restart**: the agent was already running when you connected it. Restart it as the window says.
- **Needs action**: something to do in the agent itself, spelled out in the window. Codex, for example, runs a new hook only after you trust it: in the Codex app or VS Code extension, open **Settings → Hooks** and click **Trust all**; in the Codex CLI, type `/hooks` and press `t`.

Connecting changes only SanskritLearning's own entries, keeps a backup of the agent's file, and never needs the agent to be reinstalled or updated. See [Supported agents](docs/SUPPORTED_AGENTS.md) for what each agent supports.

Your own agent can use talk-back too, with the small Python or Node client described in [Custom agents](docs/CUSTOM_AGENTS.md).

## Uninstall

Any of these does the same:

- Tray menu → **Uninstall SanskritLearning…**
- **Settings → Apps → Installed apps → SanskritLearning → Uninstall**
- In PowerShell:
  ```powershell
  powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\SanskritLearning\uninstaller\uninstall.ps1"
  ```

It asks whether to keep the downloaded speech models (to reinstall later without downloading them again) or delete them, then shows its progress and a summary. It removes the hook in every agent it connected, restoring each agent's settings; the background service, its sign-in entry, the Start menu and Settings entries; and the app, its Node.js and your SanskritLearning settings.

It works in an order that never leaves SanskritLearning half-removed:

- It first checks, changing nothing, that every agent's settings file can be restored. If one cannot (it is open in another program or is not valid), it stops and says which file, and SanskritLearning stays installed and working.
- Agents are disconnected before anything else is removed.
- Before deleting any file it moves every folder aside, which fails if a file is in use. Then it puts everything back and says which folder is in use; nothing has been deleted.
- The **Settings → Apps** entry and the uninstaller itself are removed last. If an uninstall stops for any reason, SanskritLearning no longer starts, and **Settings → Apps → SanskritLearning → Uninstall** finishes the job.

## Settings

Settings live in `%LOCALAPPDATA%\SanskritLearning\resident\settings.json`. The tray writes some of them. To edit the file, quit SanskritLearning first.

| Setting | Default | Meaning |
|---|---|---|
| `readMode` | `"talkback"` | `"talkback"` or `"off"`. |
| `hotkeys` | see above | `{"capture": "Ctrl+Shift+I", "talkback": "Ctrl+Shift+U", "disarm": "Ctrl+Shift+Y"}`. Ctrl+Shift plus a letter, number, F1–F24 or Space. |
| `language` | `"sa"` | `"sa"`: dictate Sanskrit (Su-śrotā) and read Devanagari with the Sanskrit voice. `"en"`: English dictation (Parakeet). |
| `sanskritVoice` | `"parler"` | `"parler"` (Indic Parler-TTS, conversational) or `"vagdhenu"` (chanted verse). |
| `spokenSentences`, `spokenChars` | `8`, `1000` | How much of a reply is read. `0` and `0` reads the whole reply. |
| `dateOrder` | `"dmy"` | How ambiguous dates such as 07/10/2026 are read: day first (`"dmy"`) or month first (`"mdy"`). |
| `modelsIdleMs` | `900000` | Unload the models after this many idle milliseconds. |
| `talkbackCapMs` | `7200000` | A talk-back still unused after this long is cleared (10 minutes to 24 hours). |
| `badge` | `true` | Show the status badge near the pointer. |
| `vad` | see below | How speech is found in the recording: `{"threshold": 0.3, "preSpeechSeconds": 0.75, "minSilenceSeconds": 0.5}`. |

The `vad` values tune the speech detector (Silero VAD). Leave them alone unless dictation misbehaves, and change one at a time:

| Value | Default | Range | Raise it if… | Lower it if… |
|---|---|---|---|---|
| `threshold` | `0.3` | 0.05–0.95 | background noise (fans, typing) gets transcribed as words | soft or quiet speech is missed |
| `preSpeechSeconds` | `0.75` | 0–2 | the first word of a dictation is cut off | (rarely needed) a noise just before you speak is transcribed |
| `minSilenceSeconds` | `0.5` | 0.1–2 | words around short pauses are dropped or garbled | (rarely needed) |

A pause only ends your dictation's current sentence group after about 2 seconds, whatever `minSilenceSeconds` is, and pressing the hotkey again always ends the recording. Quit SanskritLearning before editing `settings.json`, then start it again.

## Troubleshooting

Start with the tray menu → **Diagnose…**. It checks the speech models, the speech engine, the background service, the hotkeys and each connected agent's hook, and says in plain words what is wrong and what to do.

- **No tray icon:** start SanskritLearning from **Start → SanskritLearning**. If it still doesn't appear, run setup again (`& "$env:LOCALAPPDATA\SanskritLearning\app\setup.cmd"`); it repairs the installation.
- **Nothing happens on a hotkey:** hotkeys may be paused (tray menu), or another program holds the shortcut. SanskritLearning names it in a notification and takes the key back when it is free.
- **"Failed" badge:** the notification says why, for example an unavailable microphone.
- **Dictation in a terminal went to the clipboard:** that is by design; SanskritLearning does not type into terminal windows (see [Terminals](#terminals)). Paste it with Ctrl+V, or dictate into the agent's app or chat panel.
- **A reply was not read:** it is read only if you dictated the message with Ctrl+Shift+U and the agent is **Connected** in **Connect agents…**. An agent that shows **needs restart** or **needs action** isn't running the hook yet.
- **Connected, but the agent never calls SanskritLearning** (Diagnose shows "No hook call recorded yet"): the agent may still be running without its hooks loaded, for example right after it updated itself. Quit and reopen the agent. In Codex, **Settings → Hooks** should then list three SanskritLearning hooks.
- **Setup stopped:** it says why. Fix that and run it again; it carries on where it stopped.
- **Logs:** `%LOCALAPPDATA%\SanskritLearning\resident` holds `requests.jsonl` (each talk-back decision), `hooks.jsonl` (each hook call) and `resident-error.log`. They never contain your prompts or replies.

## For developers

To run from a checkout instead of installing: `npm install`, then `npm start`. `npm test` runs the tests. `node scripts/agent-hooks.cjs install <agent>` connects an agent from the command line, and `node scripts/agents.cjs list` shows what the tray shows. See the [developer guide](docs/DEVELOPER_GUIDE.md).

## Licence

SanskritLearning's own code is released under the [MIT licence](LICENSE): free to use, change and share, with no warranty. The speech models and libraries it uses are not part of this licence; they keep their own, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Setup downloads the models from their publishers, and they are not stored in this repository.
