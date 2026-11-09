# Herdr GitHub panels

A GitHub issues panel for the [Herdr](https://herdr.dev) desktop app, next to Files and Changes. It follows the repository of the focused terminal and opens issues in a GitHub-style view.

This is a fork of [jankeesvw/herdr-issues](https://github.com/jankeesvw/herdr-issues) (MIT) with one change: links in the issue view now open on macOS. Before, `openUrl` never reached `open` there, because `sh -c 'xdg-open ... &'` returns 0 even when `xdg-open` does not exist.

A Projects panel (Roadmap chart and table) was tried here and removed. It is in the git history (`mods/projects`, up to commit `bde0a6a`).

![Issues panel](preview.png)

## Install

You need the [GitHub CLI](https://cli.github.com), logged in (`gh auth login`).

```sh
git clone https://github.com/imutaroh/herdr-github-panels.git
ln -s "$PWD/herdr-github-panels/mods/issues" ~/.config/herdr-app/mods/issues
```

Then add it to the side panel stack of your layout, beside Files and Changes (the id `issues` must stay as it is):

```json
{ "id": "panel-body", "type": "stack", "children": [
  { "id": "files", "type": "block", "content": { "mod": "files" } },
  { "id": "changes", "type": "block", "content": { "mod": "changes" } },
  { "id": "issues", "type": "block", "content": { "mod": "issues" } } ] }
```

Opening the panel is up to your tab bar and keys: `run("layout.select", { stack: "panel-body", child: "issues" })` and `run("layout.show", { id: "panel" })`. The mod also draws its own button when given `props: { "button": true }`; see `layouts/main-issues.json`.

## What it runs and stores

- `gh` (`gh repo view`, `gh issue list` and `view`, `gh api`) on the machine of the space. It changes issues only when you press a button in the issue view.
- `curl` for avatars and images in issue bodies, `hc read` on the focused terminal to find `#123`, and `open` / `xdg-open` for links.
- A cache in `~/.config/herdr-app/data/issues/`.

## Credits and license

The Issues mod is by Jankees van Woezik. MIT, see `LICENSE`.
