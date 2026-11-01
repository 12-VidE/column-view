import { CONFIG, type SectionTitles } from './config';

/* Pure helpers: no Obsidian objects in here, so they are unit-testable. */

export function foldText(s: string): string {
	return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

// Normalises a heading so "Letters–Mario", "letters - Mario" and
// "**Letters** - [[Mario]]" all compare equal.
export function headingKey(s: string): string {
	return foldText(s)
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
		.replace(/[*`]/g, '')
		.replace(/\s*[-–—:]\s*/g, ' - ')
		.replace(/\s+/g, ' ')
		.trim();
}

interface Token {
	norm: string;
	start: number;
	end: number;
}

function tokenize(s: string): Token[] {
	const out: Token[] = [];
	const re = /[\p{L}\p{N}]+/gu;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null) {
		out.push({ norm: foldText(m[0]), start: m.index, end: m.index + m[0].length });
	}
	return out;
}

const EDGE = '[\\s\\-–—_:.,;|/]';
const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

export interface StripOptions {
	minChars: number;
	onlyAtEdges: boolean;
}

/* ------------------------------------------------------ RULE 1: display name */
// Removes from `name` the longest stretch of consecutive words that also appears
// (consecutively) in `xxName`. Case- and accent-insensitive. Display only.
//   stripSharedPart('Roma Antica - Lettera 1', 'Roma Antica') -> 'Lettera 1'
export function stripSharedPart(name: string, xxName: string, opts: Partial<StripOptions> = {}): string {
	const { minChars, onlyAtEdges }: StripOptions = {
		minChars: CONFIG.minStripChars,
		onlyAtEdges: CONFIG.onlyAtEdges,
		...opts,
	};
	const s = name.normalize('NFC');
	const zt = tokenize(s);
	const xt = tokenize(xxName.normalize('NFC'));
	if (!zt.length || !xt.length) return name;

	let best: { i: number; k: number; chars: number } | null = null;
	for (let i = 0; i < zt.length; i++) {
		for (let j = 0; j < xt.length; j++) {
			let k = 0;
			for (;;) {
				const a = zt[i + k];
				const b = xt[j + k];
				if (!a || !b || a.norm !== b.norm) break;
				k++;
			}
			if (k === 0) continue;
			if (onlyAtEdges && !(i === 0 || i + k === zt.length)) continue;
			const first = zt[i];
			const last = zt[i + k - 1];
			if (!first || !last) continue;
			const chars = last.end - first.start;
			if (chars < minChars) continue;
			if (!best || k > best.k || (k === best.k && chars > best.chars)) best = { i, k, chars };
		}
	}
	if (!best) return name;

	const first = zt[best.i];
	const last = zt[best.i + best.k - 1];
	if (!first || !last) return name;

	let left = s.slice(0, first.start);
	let right = s.slice(last.end);

	// "Foo (Roma Antica)" -> drop the now-empty brackets
	const opener = left.trimEnd().slice(-1);
	const closer = right.trimStart().charAt(0);
	if (OPEN_TO_CLOSE[opener] !== undefined && OPEN_TO_CLOSE[opener] === closer) {
		left = left.trimEnd().slice(0, -1);
		right = right.trimStart().slice(1);
	}
	left = left.replace(new RegExp(`${EDGE}+$`), '');
	right = right.replace(new RegExp(`^${EDGE}+`), '');

	const out = left && right ? `${left} ${right}` : left || right;
	return out || name; // never display an empty name
}

/* ---------------------------------------------- RULE 2: where the section is */
export interface HeadingInfo {
	text: string;
	level: number;
	line: number;
}

// Finds   ## <h2>   >   ### <h3>   and returns the lines strictly between the
// h3 heading and the next heading of level <= 3 (or the end of the h2 block).
export function findSectionRange(heads: HeadingInfo[], titles: SectionTitles): { start: number; end: number } | null {
	const h2keys = new Set(titles.h2.map(headingKey));
	const h3keys = new Set(titles.h3.map(headingKey));

	const i2 = heads.findIndex((h) => h.level === 2 && h2keys.has(headingKey(h.text)));
	if (i2 < 0) return null;

	let end2 = Infinity;
	for (let k = i2 + 1; k < heads.length; k++) {
		const h = heads[k];
		if (h && h.level <= 2) {
			end2 = h.line;
			break;
		}
	}

	let i3 = -1;
	for (let k = i2 + 1; k < heads.length; k++) {
		const h = heads[k];
		if (!h || h.line >= end2) break;
		if (h.level === 3 && h3keys.has(headingKey(h.text))) {
			i3 = k;
			break;
		}
	}
	const h3 = heads[i3];
	if (!h3) return null;

	let end3 = end2;
	for (let k = i3 + 1; k < heads.length; k++) {
		const h = heads[k];
		if (!h || h.line >= end2) break;
		if (h.level <= 3) {
			end3 = h.line;
			break;
		}
	}
	return { start: h3.line, end: end3 };
}
