export interface SectionTitles {
	h2: string[];
	h3: string[];
}

/**
 * Everything you are expected to tweak lives here and in rules.ts.
 * The rules are deliberately plain code, not a settings UI.
 */
export const CONFIG = {
	/* Folder notes ------------------------------------------------------- */
	// The folder note is the file INSIDE the folder whose name starts with this.
	// It is hidden in the columns. A note named exactly "@<folder name>" wins if
	// there are several, and the note is still found after the folder is renamed
	// (until Folder Notes syncs the two names).
	folderNotePrefix: '@',
	folderNoteExtensions: ['md', 'canvas', 'base'] as string[],

	/* Pattern:  XX / _Type / YY / ZZ -------------------------------------- */
	// A folder whose name starts with this is a "_Type" folder.
	typeFolderPrefix: '_',

	// RULE 2: where the virtual files of YY are declared, inside XX's folder note:
	//   ## <h2[i]>
	//   ### <h3[i]>
	// Default: "## Type" or "## Types", then "### Type - YY" or "### Types - YY",
	// where Type is the _Type folder name without its leading underscores.
	sectionTitles(typeFolderName: string, yyName: string): SectionTitles {
		const t = typeFolderName.replace(/^_+/, '');
		const h2 = [t, `${t}s`];
		return { h2, h3: h2.map((label) => `${label} - ${yyName}`) };
	},

	// RULE 1 (display rename): strip from ZZ the stretch of words shared with XX.
	minStripChars: 4, // ignore shared stretches shorter than this ("di", "the", ...)
	onlyAtEdges: false, // true = only strip when the shared part is at the very start/end of ZZ

	// RULE 2 (virtual content)
	includeEmbeds: true, // ![[image.jpg]] counts like [[link]]
	mountFolderNoteLinks: true, // [[@Foo]] (a folder note) mounts the whole folder Foo inside YY

	/* UI ------------------------------------------------------------------ */
	renderChunk: 300, // rows rendered per batch (keeps 4000-photo folders fast)
};
