# Column View

A floating column browser for your Obsidian vault. Nothing is renamed or moved on disk:
the columns only *show* a different, virtual view of your folders.

Built from the official [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
Works with **Folder Notes** and **Iconize**. No settings page, no tabs, no extras.

## Use

Click the columns icon in the left ribbon, or bind a hotkey to **Column View: Open browser**.
It floats in over your vault and opens on the note you are editing.

The complete path is always at the top. The column you are working in is always in the middle.

| Key | Does |
| --- | --- |
| `↑` `↓` | move in the column |
| `→` | step into the folder |
| `←` | step back out |
| `Enter` | open the file, or the folder's note (a folder without a note is entered) |
| `Cmd/Ctrl + Enter` | same, in a new tab |
| `Tab` or the target button | jump back to the note open in the editor |
| type a few letters | jump to the first matching name |
| `Esc` | close |

Mouse: **click a row** to show a folder (same as `→`); **click a name** to open its folder note
(same as `Enter`). Folders that have a note have an underlined name. Clicking a file opens it.

## What you see

Just names. A folder has a `>` after its name. The only icon is a custom folder icon, if you set one
with Iconize. Items that are linked in from elsewhere look like normal items; when one is, or has been
renamed for display, its real path is shown small under the title.

## Folder notes

A folder note is the file *inside* the folder whose name starts with `@`. It is hidden in the columns.
A note named exactly `@<folder name>` wins if there are several. Keeping the folder and note names
in step when you rename one is done by the Folder Notes plugin (turn its name syncing on); this plugin
only reads, and still finds the note while the two names are out of step.

## The rules (all in code, by design)

Pattern: `XX / _Type / YY / ZZ`

1. **Display rename:** ZZ loses the stretch of words it shares with XX.
2. **Virtual contents:** YY also shows every file linked (or embedded) in XX's folder note under
   `## Types` > `### Types - YY`. A link to a folder note mounts that whole folder, like a symlink.

Tune them in `src/config.ts` (options, heading names) and `src/rules.ts` (the logic).

## Build

```bash
npm install
npm run build      # or `npm run dev` to watch
npm test           # typecheck + rule tests against a fake vault (dev only)
```

Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/column-view/`.

## Layout

```
src/main.ts           plugin lifecycle only
src/config.ts         tunable rule options
src/rules.ts          pure rule logic (rename, section finder)
src/model.ts          the virtual tree
src/columns-modal.ts  the floating window
src/icons.ts          custom folder icons from Iconize
src/integrations.ts   read Folder Notes / Iconize safely
src/settings.ts       remembers where you were
test/                 `npm test`
```
