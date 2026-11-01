import { parseLinktext, TFile, TFolder, type App } from 'obsidian';
import { CONFIG } from '../../files/config';
import { folderNoteNameTemplate } from './integrations';
import { findSectionRange, foldText, stripSharedPart, type HeadingInfo } from './rules';

/* The virtual tree. Nothing here touches the disk: it only decides what each
 * column SHOWS. Every node keeps a reference to the REAL file or folder, so
 * opening, icons and folder notes always act on the real thing. */

export class VNode {
	readonly file: TFile | TFolder;
	readonly display: string; // what the column shows (after RULE 1)
	readonly original: string; // the default name, before any renaming
	readonly virtual: boolean; // true = not physically inside the folder it is listed in
	private foldCache: string | null = null;

	constructor(file: TFile | TFolder, display: string, original: string, virtual: boolean) {
		this.file = file;
		this.display = display;
		this.original = original;
		this.virtual = virtual;
	}

	get isFolder(): boolean {
		return this.file instanceof TFolder;
	}

	asFolder(): TFolder | null {
		return this.file instanceof TFolder ? this.file : null;
	}

	// Lower-cased, accent-free display name, for type-ahead matching.
	get fold(): string {
		if (this.foldCache === null) 
			this.foldCache = foldText(this.display);
		return this.foldCache!;
	}
}

// A folder "YY" located as  XX / _Type / YY
export interface PatternContext {
	xx: TFolder;
	type: TFolder;
	yy: TFolder;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareNodes(a: VNode, b: VNode): number {
	if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
	return COLLATOR.compare(a.display, b.display);
}

export class VaultModel {
	private app: App;
	private children = new Map<string, VNode[]>();
	private notes = new Map<string, TFile | null>();

	constructor(app: App) {
		this.app = app;
	}

	invalidate(): void {
		this.children.clear();
		this.notes.clear();
	}

	root(): TFolder {
		return this.app.vault.getRoot();
	}

	/* ------------------------------------------------------- Folder Notes */
	private folderNoteNames(folder: TFolder): Set<string> {
		const names = new Set<string>();
		for (const tpl of [folderNoteNameTemplate(this.app), `${CONFIG.folderNotePrefix}{{folder_name}}`]) {
			if (tpl) names.add(tpl.replace(/\{\{folder_name\}\}/g, folder.name));
		}
		return names;
	}

	// The folder note is the file INSIDE the folder whose name starts with "@".
	// A note named exactly like the folder ("@<folder name>") wins; otherwise the
	// first "@" file by name is used, so the note is still recognised right after
	// the folder is renamed, before Folder Notes has synced the two names.
	getFolderNote(folder: TFolder): TFile | null {
		if (folder.isRoot()) return null;
		const cached = this.notes.get(folder.path);
		if (cached !== undefined) return cached;
		const exact = this.folderNoteNames(folder);
		let exactHit: TFile | null = null;
		let prefixHit: TFile | null = null;
		for (const c of folder.children) {
			if (!(c instanceof TFile) || !CONFIG.folderNoteExtensions.includes(c.extension)) continue;
			if (exact.has(c.basename)) {
				exactHit = c;
				break;
			}
			if (c.basename.startsWith(CONFIG.folderNotePrefix) && (!prefixHit || c.name.localeCompare(prefixHit.name) < 0)) {
				prefixHit = c;
			}
		}
		const found = exactHit ?? prefixHit;
		this.notes.set(folder.path, found);
		return found;
	}

	/* ------------------------------------------------------ Rule detection */
	// Is `folder` a "YY" in  XX / _Type / YY ?
	patternContext(folder: TFolder): PatternContext | null {
		const type = folder.parent;
		const xx = type?.parent;
		if (!type || !xx || type.isRoot() || xx.isRoot()) return null;
		if (!type.name.startsWith(CONFIG.typeFolderPrefix)) return null;
		return { xx, type, yy: folder };
	}

	/* ------------------------------------------- RULE 2: virtual contents */
	// Files linked under  "## Types" > "### Types - YY"  in XX's folder note.
	private linkedTargets(ctx: PatternContext): TFile[] {
		const note = this.getFolderNote(ctx.xx);
		if (!note || note.extension !== 'md') return [];
		const cache = this.app.metadataCache.getFileCache(note);
		if (!cache?.headings) return [];

		const heads: HeadingInfo[] = cache.headings.map((h) => ({
			text: h.heading,
			level: h.level,
			line: h.position.start.line,
		}));
		const range = findSectionRange(heads, CONFIG.sectionTitles(ctx.type.name, ctx.yy.name));
		if (!range) return [];

		const refs = [...(cache.links ?? []), ...(CONFIG.includeEmbeds ? (cache.embeds ?? []) : [])];
		const out: TFile[] = [];
		const seen = new Set<string>();
		for (const r of refs) {
			const line = r.position.start.line;
			if (line <= range.start || line >= range.end) continue;
			const { path } = parseLinktext(r.link);
			if (!path) continue; // [[#heading]] points into the same note
			const f = this.app.metadataCache.getFirstLinkpathDest(path, note.path);
			if (f instanceof TFile && !seen.has(f.path)) {
				seen.add(f.path);
				out.push(f);
			}
		}
		return out;
	}

	/* ------------------------------------------------------------ Nodes */
	private defaultName(file: TFile | TFolder): string {
		if (file instanceof TFolder) return file.name;
		return file.extension === 'md' ? file.basename : file.name;
	}

	// RULE 1 applies to FILES shown in YY, using the REAL XX of that YY, so a
	// symlinked YY shows exactly the same names wherever it appears.
	private displayFor(file: TFile | TFolder, ctx: PatternContext | null): string {
		if (file instanceof TFolder || !ctx) return this.defaultName(file);
		const stripped = stripSharedPart(file.basename, ctx.xx.name);
		return file.extension === 'md' ? stripped : `${stripped}.${file.extension}`;
	}

	private makeNode(file: TFile | TFolder, ctx: PatternContext | null, virtual: boolean): VNode {
		return new VNode(file, this.displayFor(file, ctx), this.defaultName(file), virtual);
	}

	childrenOf(folder: TFolder): VNode[] {
		const hit = this.children.get(folder.path);
		if (hit) return hit;

		const note = this.getFolderNote(folder);
		const ctx = this.patternContext(folder);
		const items: VNode[] = [];
		const seen = new Set<string>();

		for (const c of folder.children) {
			if (!(c instanceof TFile) && !(c instanceof TFolder)) continue;
			if (c === note) continue; // the folder note is hidden
			if (c.name.startsWith('.')) continue;
			seen.add(c.path);
			items.push(this.makeNode(c, ctx, false));
		}

		if (ctx) {
			for (const t of this.linkedTargets(ctx)) {
				let target: TFile | TFolder = t;
				const parent = t.parent;
				if (CONFIG.mountFolderNoteLinks && parent && !parent.isRoot() && this.getFolderNote(parent) === t) {
					target = parent; // a link to a folder note => the folder itself appears here
				}
				if (target === folder || seen.has(target.path)) continue;
				seen.add(target.path);
				items.push(this.makeNode(target, ctx, true));
			}
		}

		items.sort(compareNodes);
		this.children.set(folder.path, items);
		return items;
	}

	// Path chain (real location) used to reveal a file in the columns.
	chainFor(file: TFile | TFolder): string[] {
		let cur: TFile | TFolder | null = file;
		const parent = file.parent;
		if (file instanceof TFile && parent && !parent.isRoot() && this.getFolderNote(parent) === file) {
			cur = parent; // a folder note is hidden: select its folder instead
		}
		const chain: string[] = [];
		while (cur && cur.parent) { // the vault root is the only item without a parent
			chain.unshift(cur.path);
			cur = cur.parent;
		}
		return chain;
	}
}
