# Herdr GitHub panels

Two side panels for the [Herdr](https://herdr.dev) desktop app, next to Files and Changes:

- **Issues**: the issues of the focused terminal's repository, with a GitHub-style issue view. This is [jankeesvw/herdr-issues](https://github.com/jankeesvw/herdr-issues) (MIT), kept as it is except for a macOS fix: links in the issue view now open on macOS.
- **Projects**: the GitHub Projects (v2) linked to that repository, as a Roadmap-style chart or a table. Added in this fork. Read only.

![Issues panel](preview.png)

## Projects

- **Roadmap**: each item is a bar from a start date to an end date, with month lines and a line for today. `+` and `−` zoom. GitHub does not expose the settings of its own Roadmap view through the API, so the dates are picked by field name: a Date field named like *start* and one named like *end*, *target* or *due*; a single Date field shows as a short bar; with no Date field, an Iteration field gives each item its iteration's span. Items without a date are counted, not drawn.
- **Table**: the items with their Status, Date and Iteration fields.
- A Project shows when it is linked to the repository (`gh project link <number> --repo <owner/repo>`). Several linked Projects get a switcher.
- It loads the first 100 items of a Project and says so when there are more.
- Refreshes every minute while the panel is open, and with the Refresh button.

Reading Projects needs one more permission for `gh`:

```sh
gh auth refresh -h github.com -s read:project
```

Without it the panel says so and shows this command.

Status: the chart and the table were checked in Herdr with made-up data. It has not yet been run against a real linked Project with date fields.

## Install

You need the [GitHub CLI](https://cli.github.com), logged in (`gh auth login`).

```sh
git clone https://github.com/imutaroh/herdr-github-panels.git
ln -s "$PWD/herdr-github-panels/mods/issues" ~/.config/herdr-app/mods/issues
ln -s "$PWD/herdr-github-panels/mods/projects" ~/.config/herdr-app/mods/projects
```

Then add both to the side panel stack of your layout, beside Files and Changes (ids `issues` and `projects` must stay as they are):

```json
{ "id": "panel-body", "type": "stack", "children": [
  { "id": "files", "type": "block", "content": { "mod": "files" } },
  { "id": "changes", "type": "block", "content": { "mod": "changes" } },
  { "id": "issues", "type": "block", "content": { "mod": "issues" } },
  { "id": "projects", "type": "block", "content": { "mod": "projects" } } ] }
```

Opening a panel is up to your tab bar and keys: `run("layout.select", { stack: "panel-body", child: "projects" })` and `run("layout.show", { id: "panel" })`. The Issues mod also draws its own button when given `props: { "button": true }`; see `layouts/main-issues.json`.

## What it runs and stores

- `gh` (`gh api graphql`, `gh repo view`, and for Issues `gh issue ...`) on the machine of the space. Projects only reads. Issues changes things only when you press a button in the issue view.
- Issues also runs `curl` for avatars and images in issue bodies, `hc read` on the focused terminal to find `#123`, and `open` / `xdg-open` for links.
- Issues keeps a cache in `~/.config/herdr-app/data/issues/`. Projects keeps only a few settings in the mod's local storage.

## Credits and license

The Issues mod is by Jankees van Woezik, from [herdr-issues](https://github.com/jankeesvw/herdr-issues). MIT, see `LICENSE`.
