/**
 * Render smoke test for the browser half.
 *
 * Loads client.js with a minimal window/document/React stub, captures the two
 * slot registrations, and renders the pill and the popover directly. It proves
 * the module shape, the effort ladder mapping and the write path without a
 * browser.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, '..', 'client.js'), 'utf8');

/* --- minimal React ------------------------------------------------------- */

function createElement(type, props, ...children) {
	return { type, props: props ?? {}, children: children.flat(Infinity) };
}

const React = {
	createElement,
	useState(initial) {
		return [typeof initial === 'function' ? initial() : initial, () => {}];
	},
	useEffect(effect) {
		if (typeof effect === 'function') effect();
	},
	useLayoutEffect(effect) {
		if (typeof effect === 'function') effect();
	},
	useRef(value) {
		return { current: value };
	},
	useCallback(fn) {
		return fn;
	},
	useMemo(fn) {
		return fn();
	},
	memo: (component) => component,
};

/* --- minimal browser ----------------------------------------------------- */

const storage = new Map();
let moduleExports = null;

const styleElement = {
	setAttribute() {},
	set textContent(_value) {},
};

const fakeDocument = {
	head: { appendChild() {} },
	body: { appendChild() {}, removeChild() {}, dispatchEvent() {} },
	documentElement: { lang: 'en' },
	createElement() {
		return styleElement;
	},
	querySelector: () => null,
	listeners: new Map(),
	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	},
	removeEventListener(type) {
		this.listeners.delete(type);
	},
};

const fakeWindow = {
	__ModuleLoader__: {
		load(definition) {
			moduleExports = definition.factory;
		},
	},
	document: fakeDocument,
	matchMedia: () => ({ matches: false }),
	localStorage: {
		getItem: (key) => (storage.has(key) ? storage.get(key) : null),
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
	},
	innerWidth: 1280,
	innerHeight: 800,
	devicePixelRatio: 2,
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	addEventListener() {},
	removeEventListener() {},
};

class FakeMouseEvent {
	constructor(type, init) {
		this.type = type;
		this.bubbles = init?.bubbles === true;
		this.cancelable = init?.cancelable === true;
	}
}

class FakeElement {}

const sandbox = {
	window: fakeWindow,
	Element: FakeElement,
	MouseEvent: FakeMouseEvent,
	document: fakeDocument,
	navigator: { language: 'en' },
	performance: { now: () => 0 },
	console,
	requestAnimationFrame: fakeWindow.requestAnimationFrame,
	cancelAnimationFrame: fakeWindow.cancelAnimationFrame,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	Math,
	Date,
	JSON,
	Float32Array,
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });

assert.ok(typeof moduleExports === 'function', 'module factory registered');
const plugin = moduleExports((id) => {
	assert.equal(id, 'react');
	return React;
});
assert.equal(Array.from(plugin.inject).join(','), 'slots,locale,modelDirectories');
assert.equal(typeof plugin.apply, 'function');

/* --- plugin context ------------------------------------------------------ */

const registrations = [];

const directory = {
	store: {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
	},
	load: async () => snapshot,
	select: async (selection) => {
		writes.push(selection);
		return { ok: true };
	},
};

const writes = [];

const snapshotState = {
	current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' },
	groups: [
		{
			id: 'opencode-go',
			models: [
				{
					id: 'deepseek-v4.1-flash',
					name: 'DeepSeek V4.1 Flash',
					reasoning: {
						defaultEffort: 'medium',
						efforts: [
							{ id: 'off', name: 'Off' },
							{ id: 'low', name: 'Low' },
							{ id: 'medium', name: 'Medium' },
							{ id: 'high', name: 'High' },
							{ id: 'max', name: 'Max' },
						],
					},
				},
			],
		},
	],
	status: 'ready',
	error: null,
};

let snapshot = snapshotState;

const ctx = {
	get: (name) => ({ modelDirectories: { directoryFor: () => directory } })[name],
	effect: (factory) => {
		const stop = factory();
		return typeof stop === 'function' ? stop : () => {};
	},
	locale: { register: () => () => {} },
	slots: {
		inject: (_key, callback) => callback(),
		register: (options, component) => {
			registrations.push({ options, component });
			return () => {};
		},
	},
};

plugin.apply(ctx);

assert.equal(registrations.length, 2, 'two slot entries');
const pillEntry = registrations.find((entry) => entry.options.name === 'conversation.input.right');
const panelEntry = registrations.find((entry) => entry.options.name === 'conversation.input.overlay');
assert.ok(pillEntry, 'pill registered in conversation.input.right');
assert.ok(panelEntry, 'popover registered in conversation.input.overlay');

/* --- render helpers ------------------------------------------------------ */

const t = (key) => key;

function injected(entry, sessionId) {
	const face = entry.options.inject(sessionId);
	// The renderer binds `hooks.*` with useSyncExternalStore, which subscribes;
	// subscribing is also what makes the directory proxy resolve its target.
	face.hooks.effortDirectory.subscribe(() => {});
	const { hooks: _hooks, ...props } = face;
	// `t` and the hook are bound by the slot kit; the stub mirrors that binding.
	return {
		...props,
		t,
		...{ useEffortDirectory: (selector) => selector(directory.store.getSnapshot()) },
	};
}

function textOf(node) {
	if (node === null || node === undefined || node === false) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	return (node.children ?? []).map(textOf).join('');
}

function findAll(node, predicate, found = []) {
	if (node === null || typeof node !== 'object') return found;
	if (predicate(node)) found.push(node);
	for (const child of node.children ?? []) findAll(child, predicate, found);
	return found;
}

/* --- pill ---------------------------------------------------------------- */

const pill = pillEntry.component(injected(pillEntry, 'session-1'));
assert.equal(textOf(pill), 'Effort: Max');
assert.equal(pill.props['aria-expanded'], 'false');
assert.match(pill.props['aria-label'], /Open effort settings/);

/* --- popover ------------------------------------------------------------- */

function openPanel(sessionId) {
	const props = injected(panelEntry, sessionId);
	props.controller.open(null);
	const rendered = panelEntry.component(props);
	assert.ok(rendered, 'panel renders while open');
	// EffortPanel forwards to PanelBody; render the child element the way the
	// slot renderer would.
	const tree = typeof rendered.type === 'function' ? rendered.type(rendered.props) : rendered;
	return { props, tree };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function part(tree, predicate) {
	return findAll(tree, predicate)[0];
}

{
	// A session persisted at "max" with no Ultracode mode opens on Max.
	const { props, tree } = openPanel('session-1');
	const popover = part(tree, (node) => String(node.props?.className ?? '').includes('ccs-popover'));
	assert.ok(popover, 'popover element');
	assert.equal(String(popover.props.className).includes('is-ultra'), false);
	assert.equal(textOf(popover).includes('Max'), true);

	const stops = findAll(tree, (node) => node.props?.className === 'ccs-stop');
	assert.equal(stops.length, 5, 'five stop dots');

	const slider = part(tree, (node) => node.props?.role === 'slider');
	assert.equal(slider.props['aria-valuemax'], 4);
	assert.equal(slider.props['aria-valuenow'], 3, 'Max is the third index of five');
	assert.equal(findAll(tree, (node) => node.type === 'canvas').length, 1, 'energy grid canvas');

	// Home submits the model's least thinking effort.
	slider.props.onKeyDown({ key: 'Home', preventDefault() {} });
	await flush();
	assert.equal(writes.at(-1).reasoningEffort, 'low');

	// End submits the model's maximum thinking effort — the Ultracode mapping —
	// and marks the session's Ultracode mode.
	slider.props.onKeyDown({ key: 'End', preventDefault() {} });
	await flush();
	assert.equal(storage.get('dsh-claude-effort:ultracode:session-1'), '1');

	props.controller.close();
	assert.equal(panelEntry.component(props), null, 'panel unmounts when closed');
}

{
	// With the mode stored, the same session reopens on Ultracode.
	const { props, tree } = openPanel('session-1');
	const popover = part(tree, (node) => String(node.props?.className ?? '').includes('ccs-popover'));
	assert.equal(String(popover.props.className).includes('is-ultra'), true, 'Ultracode look');
	assert.equal(textOf(popover).includes('Ultracode'), true);
	props.controller.close();
}

{
	// A ladder change from elsewhere re-derives every level from the effort id.
	snapshot = {
		...snapshotState,
		current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' },
	};
	const { props, tree } = openPanel('session-1');
	const slider = part(tree, (node) => node.props?.role === 'slider');
	assert.equal(slider.props['aria-valuenow'], 0, 'low is the first level');

	slider.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
	await flush();
	assert.equal(writes.at(-1).reasoningEffort, 'medium');

	slider.props.onKeyDown({ key: 'End', preventDefault() {} });
	await flush();
	assert.equal(writes.at(-1).reasoningEffort, 'max', 'Ultracode writes the top of the ladder');
	props.controller.close();
	snapshot = snapshotState;
}

/* --- shipped Effort row is replaced ------------------------------------- */

{
	snapshot = snapshotState;
	// Rendering the pill claims the live session for the interceptor.
	pillEntry.component(injected(pillEntry, 'session-1'));

	const row = {
		textContent: 'Effortmax',
		getBoundingClientRect: () => ({ right: 900, width: 120, height: 34, top: 500 }),
	};
	const target = {
		closest: (selector) => (selector === 'button[role="menuitem"]' ? row : null),
	};
	let prevented = false;
	let stopped = false;
	const click = fakeDocument.listeners.get('click');
	assert.equal(typeof click, 'function', 'interceptor installed');

	click({
		target,
		altKey: false,
		metaKey: false,
		ctrlKey: false,
		preventDefault: () => {
			prevented = true;
		},
		stopPropagation: () => {
			stopped = true;
		},
	});
	assert.equal(prevented, true, 'the shipped row does not drill');
	assert.equal(stopped, true, 'the shipped row does not receive the click');

	const props = injected(panelEntry, 'session-1');
	assert.equal(props.controller.getSnapshot().open, true, 'the popover opened instead');
	props.controller.close();

	// A modifier click keeps the shipped level pane reachable.
	prevented = false;
	click({
		target,
		altKey: true,
		metaKey: false,
		ctrlKey: false,
		preventDefault: () => {
			prevented = true;
		},
		stopPropagation: () => {},
	});
	assert.equal(prevented, false, 'modifier click falls through');
}

/* --- unsupported model --------------------------------------------------- */

snapshot = {
	current: { provider: 'local', model: 'no-reasoning' },
	groups: [{ id: 'local', models: [{ id: 'no-reasoning', name: 'No Reasoning' }] }],
	status: 'ready',
	error: null,
};

assert.equal(pillEntry.component(injected(pillEntry, 'session-2')), null, 'no pill without a ladder');

{
	const props = injected(panelEntry, 'session-2');
	props.controller.open(null);
	const unsupported = panelEntry.component(props);
	const panel = typeof unsupported.type === 'function' ? unsupported.type(unsupported.props) : unsupported;
	assert.ok(textOf(panel).includes('unsupported'), 'panel explains the missing ladder');
	props.controller.close();
}

/* --- cold-start directory lookup retries -------------------------------- */

{
	// A slot inject face is cached per binding, so the first cold render must not
	// be able to freeze the control: the injected store retries until the session
	// exposes its directory.
	let attempts = 0;
	const flaky = {
		directoryFor: () => {
			attempts += 1;
			if (attempts <= 2) throw new Error('session "' + 'session-3' + '" resolved no scope');
			return directory;
		},
	};
	const flakyCtx = {
		get: (name) => ({ modelDirectories: flaky })[name],
		effect: (factory) => {
			const stop = factory();
			return typeof stop === 'function' ? stop : () => {};
		},
		locale: { register: () => () => {} },
		slots: {
			inject: (_key, callback) => callback(),
			register: (options, component) => {
				flakyRegistrations.push({ options, component });
				return () => {};
			},
		},
	};
	const flakyRegistrations = [];
	plugin.apply(flakyCtx);
	const entry = flakyRegistrations.find((row) => row.options.name === 'conversation.input.right');
	const face = entry.options.inject('session-3');
	const store = face.hooks.effortDirectory;

	assert.equal(store.getSnapshot(), null, 'no snapshot before the directory resolves');
	assert.equal(face.getDirectory(), null, 'no directory before the retry lands');

	const pendingPill = entry.component({
		...face,
		t,
		...{ useEffortDirectory: (selector) => selector(store.getSnapshot()) },
	});
	assert.equal(textOf(pendingPill), 'Effort: …', 'pending pill still renders a label');
	assert.notEqual(pendingPill.props.disabled, true, 'pending pill is not disabled');
	assert.equal(typeof pendingPill.props.onClick, 'function', 'pending pill opens the popover');

	let notified = 0;
	store.subscribe(() => {
		notified += 1;
	});
	await new Promise((resolve) => setTimeout(resolve, 900));

	assert.ok(store.getSnapshot(), 'the proxy resolved the directory on a retry');
	assert.ok(face.getDirectory(), 'writes can now reach the directory');
	assert.ok(notified > 0, 'subscribers were told when it resolved');
}

console.log('smoke: ok');
