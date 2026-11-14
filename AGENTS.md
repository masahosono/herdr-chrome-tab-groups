# AGENTS.md

Notes for AI agents working on this repository. What the layout looks like and how it behaves is in [RECIPE.md](RECIPE.md); when you change behavior, update RECIPE.md too.

## Publishing

This is a layout for the [herdr.dev gallery](https://herdr.dev/gallery/). The repository root mirrors `~/.config/herdr-app` (`layouts/<name>.json` and `mods/<name>/`), plus `RECIPE.md` and `preview.png`. A public repository with the GitHub topic `herdr-layout` shows up in the gallery within the hour. How to write `RECIPE.md` is described under "Layouts and mods other people made" in the `~/.config/herdr-app/AGENTS.md` that Herdr App generates.

Anyone should be able to install it as is, so keep it self-contained. There is no `keys.json`; the layout works with Herdr's default keys.

## Running it while developing

Link the repository into `~/.config/herdr-app/` file by file, so edits show up in the app:

```bash
R=/path/to/herdr-chrome-tab-groups  # where you cloned this repository
ln -sf $R/layouts/chrome-tab-groups.json ~/.config/herdr-app/layouts/chrome-tab-groups.json
M=~/.config/herdr-app/mods/chrome-tab-groups
mkdir -p $M/icons
ln -sf $R/mods/chrome-tab-groups/main.js $M/main.js
ln -sf $R/mods/chrome-tab-groups/mod.json $M/mod.json
cp $R/mods/chrome-tab-groups/icons/*.svg $M/icons/
```

- Don't link `mods/chrome-tab-groups/` or `~/.config/herdr-app/layouts/` as whole directories: a linked mod directory doesn't load its SVGs, and Herdr writes click state (`.state/`) and its shipped layouts into `layouts/`.
- The icons are copies. After adding or renaming an SVG, copy it again and delete the stale one.
- If an edit doesn't show up, `touch -h` the link or restart the app.
- Layout errors go to `~/.config/herdr-app/layout.error`. Switch layouts with `layout.switch` (Cmd+Shift+L) or in Settings.

## Files

### `layouts/chrome-tab-groups.json`

Cloned from the shipped `main` with `herdr-app do layout.clone` (it records `cloned_from`). Shipped layouts (`main`, `terminals`, `win98`) are read-only and overwritten on every start, so edit this one. Its `brand`, `spaces` and `sidebar-footer` blocks use the `chrome-tab-groups` mod.

### `mods/chrome-tab-groups/`

The layout's only mod. Its gotchas are under "Watch out" in RECIPE.md.

- **Views**: `props().view` picks what a copy draws. The layout uses `bar` (the sidebar's top bar), `footer` (Settings and Add machine) and the default `list` (the Spaces list). The mod opens its own popups (`space-menu`, `group-menu`) as more views through `openOverlay`. The `Chrome` class draws `bar` and `footer`.
- **Groups**: `list` in the saved data holds the groups (id, name, color, folded) and `of` maps spaces to groups. Change them with `changeGroups` (shares the change and writes the file) or `shareGroups` (shares it only; the list writes the file later).
- **Tab tree**: `tabRows` draws one row per tab; a tab with two or more panes gets side-by-side `pill`s. A pill's `×` shows only on the focused pane and on `hoverPane`.
- **Icons**: SVGs live in `icons/`; `ICON(name)` gives `mods/chrome-tab-groups/icons/<name>.svg`.
