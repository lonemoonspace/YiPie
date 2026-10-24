# 一瞥 YiPie

English | [简体中文](README.zh-CN.md)

YiPie (一瞥, "a glance") is a free, open source Chrome / Edge extension. It summarizes the current web page in a floating panel, using an OpenAI-compatible model service you configure yourself, and lets you ask follow-up questions about the page.

## Features

- **Bring your own model**: works with any OpenAI Chat Completions compatible API, such as OpenAI, DeepSeek, OpenRouter, or a local Ollama or vLLM. Enter a base URL, a key and a model name. You can set up several models and switch between them in the panel.
- **No third party in between**: page content travels only between your browser and your own model service. There is no relay server and no telemetry. See the [privacy policy](PRIVACY.md).
- **Reads only when asked**: the extension requests no site permissions at install time, and reads the current page only when you click the toolbar icon, use the context menu or press the shortcut.
- **Citations you can follow**: click a citation marker in an answer and the page scrolls to the quoted text and highlights it.
- **English and Chinese interface**, dark theme, and full keyboard operation.
- Supports Chrome / Edge 110 and later.

## Status

The current version is 0.1.4. Packages are on [GitHub Releases](https://github.com/lonemoonspace/YiPie/releases), and a Chrome Web Store listing is under way (the store and the release ship the same package). See [CHANGELOG.md](CHANGELOG.md) for what changed in each version, and [docs/development-plan.md](docs/development-plan.md) (in Chinese) for the roadmap, technical decisions and acceptance criteria.

## Install

1. Download `yipie-<version>-chrome.zip` from [Releases](https://github.com/lonemoonspace/YiPie/releases) and unzip it.
2. Open `chrome://extensions` (`edge://extensions` in Edge), turn on Developer mode, click "Load unpacked" and choose the unzipped folder.

You can also build it yourself, as described under [Development](#development).

## Usage

1. **Set up a model**: open the extension's options page (in `chrome://extensions`, Details → Extension options). Under Models, enter a base URL (for example `https://api.openai.com/v1`), an API key and a model name, then save. Allow access when the browser asks about the service. "Common services" fills in a base URL for you, "Fetch models" picks a model name from the service's model list, and "Test connection" checks the address and key first. You can add several models and pick one with "Make default".
2. **Summarize**: on a web page, click the YiPie toolbar icon, press `Alt+Shift+Y`, or right-click the page and choose "Summarize this page with YiPie". The panel opens at the top right of the page and summarizes with the default model and prompt. Drag the icon at its top left to move it, and click × to close it; the ⋯ menu has "Copy text" and "Open settings". To start summaries yourself, turn off "Summarize when the panel opens" under General in the settings.
3. **Switch the model or prompt**: the two menus in the panel toolbar change the model and the prompt, and the choice becomes the new default. A new model redoes the latest answer; a new prompt clears the page's conversation and summarizes again. To switch between several models of one service, fill in "Models to switch between in the panel" for that model configuration, and the panel's model menu lists them grouped by service.
4. **Ask follow-ups**: after the summary, keep asking in the box at the bottom of the panel. If you reload the page or close the panel, open it again and the conversation comes back; it is dropped when the tab closes.
5. **Summarize a selection**: select some text, right-click and choose "Summarize the selection with YiPie".
6. **Check the source**: the small numbered markers in an answer are citations. Click one and the page scrolls to the quoted text and highlights it.
7. **Tune the summaries**: three prompt presets are built in (Page summary, Quick read and Reading notes). Edit them or add your own under Prompts in the settings; expand "Preview" while editing to see what is sent to the model. Under General you choose how to cut text that is too long, the answer language, the panel text size and the interface language. Enter each model's real context window under Models so text is cut at the right length.
8. **Back up and move**: "Import and export" in the settings saves models and prompts to a JSON file you can load in another browser. API keys are left out unless you tick the option to include them.

### Tips

- The panel cannot open on built-in browser pages (`chrome://`, the new tab page) or extension stores; the icon shows "!" there.
- In single-page apps the panel closes when you navigate within the site. Open it again on the new page; going back to the earlier page and opening it there restores that page's conversation.
- For a local Ollama, use the base URL `http://localhost:11434/v1`. If Ollama rejects the extension's requests, set the environment variable `OLLAMA_ORIGINS=chrome-extension://*` before starting it.

## Development

Requires Node 22.18 or later.

```sh
npm ci
npm run gate    # type check, unit tests, lint, format check
npm run build   # output in .output/chrome-mv3
```

Open `chrome://extensions` in Chrome, turn on Developer mode, click "Load unpacked" and choose `.output/chrome-mv3`. Development conventions are in [AGENTS.md](AGENTS.md) (in Chinese).

To try a build without building it yourself: whenever the CI quality checks pass on a push, the production build is uploaded as an artifact (`yipie-chrome-<commit>`, kept for 14 days) on that run's page. Download and unzip it, then load the folder with "Load unpacked" as above.

## License

[MIT](LICENSE)
