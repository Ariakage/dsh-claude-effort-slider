/*
 * dsh-claude-effort-slider — browser half.
 *
 * A 1:1 port of the Claude Desktop effort popover (neutral CDS track, white
 * pill thumb, five stops, Faster/Smarter ends, High-usage warning, Ultracode
 * toggle and the WebGL2 energy grid) mounted into the DeepSeek Harness
 * composer. The five presentation levels drive the session's reasoning effort
 * through the same model directory the shipped Effort row uses; Ultracode
 * always lands on the model's maximum thinking effort.
 */
window.__ModuleLoader__.load({
	id: 'dsh-claude-effort-slider',
	factory(require) {
		'use strict';

		const React = require('react');
		const h = React.createElement;
		const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

		const PKG_ID = 'dsh-claude-effort-slider';
		const NS = 'cc-effort-slider';
		const ULTRA_FLAG_PREFIX = 'dsh-claude-effort:ultracode:';

		/* ================================================================
		   Levels — verbatim copy of the reference control
		   ================================================================ */

		const LEVELS = [
			{ name: 'Low', desc: 'Quick answers with minimal deliberation.' },
			{ name: 'Medium', desc: 'Balanced speed and reasoning for everyday tasks.' },
			{ name: 'High', desc: 'Deeper reasoning for complex problems.' },
			{
				name: 'Max',
				desc: 'Maximum reasoning. Uses your limits faster.',
				warning: 'Claude thinks longer with Max effort and uses your limits faster than High.',
			},
			{ name: 'Ultracode', desc: 'Highest effort, plus dynamic workflows for this session.' },
		];

		const N = LEVELS.length; // 5
		const ULTRA = N - 1; // 4
		const MAX_LEVEL = N - 2; // 3

		/** Effort-id preferences per presentation level, in descending priority. */
		const PREFERRED = [
			['low', 'minimal', 'medium'],
			['medium', 'low', 'high'],
			['high', 'medium', 'max'],
			['max', 'xhigh', 'high'],
		];

		const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
		const smooth = (t) => t * t * (3 - 2 * t);

		const reduceMotion =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		/* ================================================================
		   Model ladder — the five presentation levels over the model's own
		   advertised thinking efforts
		   ================================================================ */

		/**
		 * Map one presentation level onto an index of the model ladder.
		 * @param {string[]} ids - advertised effort ids, least → greatest.
		 * @param {number} level - presentation level, 0..4.
		 * @returns {number} ladder index, or -1 when the ladder is empty.
		 */
		function levelToIndex(ids, level) {
			const n = ids.length;
			if (n <= 0) return -1;
			if (n === 1) return 0;
			if (level >= ULTRA) return n - 1;
			const preferred = PREFERRED[level];
			for (const candidate of preferred) {
				const at = ids.indexOf(candidate);
				if (at >= 0) return at;
			}
			return clamp(Math.round((level * (n - 1)) / (N - 1)), 0, n - 1);
		}

		/**
		 * Build the monotonic level → ladder map. Ultracode is always the top of
		 * the ladder, which is what makes it the model's maximum thinking effort.
		 * @param {string[]} ids - advertised effort ids.
		 * @returns {number[]} five ladder indexes (empty when there is no ladder).
		 */
		function buildMap(ids) {
			const n = ids.length;
			if (n <= 0) return [];
			const map = [];
			for (let level = 0; level < N; level += 1) map.push(levelToIndex(ids, level));
			map[ULTRA] = n - 1;
			for (let level = 1; level < N; level += 1) {
				if (map[level] < map[level - 1]) map[level] = map[level - 1];
			}
			return map;
		}

		/**
		 * Read the presentation level that a persisted effort id corresponds to.
		 * @param {string[]} ids - advertised effort ids.
		 * @param {number[]} map - level → ladder indexes.
		 * @param {string|null} effortId - persisted effort id.
		 * @param {boolean} ultra - whether the session carries the Ultracode mode.
		 * @returns {number} presentation level, 0..4.
		 */
		function levelForEffort(ids, map, effortId, ultra) {
			if (ids.length === 0 || map.length === 0) return 0;
			const top = ids[ids.length - 1];
			if (effortId === null || effortId === undefined) return ULTRA;
			if (ultra && effortId === top) return ULTRA;
			for (let level = 0; level < ULTRA; level += 1) {
				if (ids[map[level]] === effortId) return level;
			}
			if (effortId === top) return MAX_LEVEL;
			return 0;
		}

		const readFlag = (sessionId) => {
			try {
				return window.localStorage.getItem(ULTRA_FLAG_PREFIX + sessionId) === '1';
			} catch (_error) {
				return false;
			}
		};

		const writeFlag = (sessionId, on) => {
			try {
				if (on) window.localStorage.setItem(ULTRA_FLAG_PREFIX + sessionId, '1');
				else window.localStorage.removeItem(ULTRA_FLAG_PREFIX + sessionId);
			} catch (_error) {
				/* private mode — the mode then lasts for this page only */
			}
		};

		/**
		 * Derive the whole view state from one model-directory snapshot.
		 * @param {object|null} snapshot - directory snapshot.
		 * @returns {object} current selection, ladder, map and status flags.
		 */
		function describe(snapshot) {
			const state = snapshot || {};
			const current = state.current || null;
			const groups = state.groups || [];
			let model = null;
			if (current !== null) {
				const group = groups.find((entry) => entry.id === current.provider);
				if (group) model = group.models.find((entry) => entry.id === current.model) || null;
			}
			const reasoning = (model && model.reasoning) || null;
			const efforts = (reasoning && reasoning.efforts) || [];
			const ids = efforts.filter((entry) => entry.id !== 'off').map((entry) => entry.id);
			const effective = current
				? current.reasoningEffort || (reasoning && reasoning.defaultEffort) || null
				: null;
			const map = buildMap(ids);
			const status = state.status || 'loading';
			const loading = current === null && (status === 'loading' || status === 'idle');
			const usable = current !== null && ids.length >= 2 && map.length === N;
			return {
				current,
				reasoning,
				ids,
				map,
				effective,
				loading,
				usable,
				error: state.error || null,
			};
		}

		/* ================================================================
		   WebGL2 energy grid — ported from the reference implementation
		   ================================================================ */

		const GRID_VS = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;
out vec2 vUv;

void main() {
  vUv = (aPos * 0.5 + 0.5) * uRes;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

		const GRID_FS = `#version 300 es
precision highp float;

uniform vec2  uRes;      // CSS pixels, not device pixels: the cells are 4 CSS px
uniform float uTime;
uniform float uFade;
uniform float uPos;      // thumb center / track width
uniform float uSeed;

uniform vec3  uHot;      // lavender ink
uniform vec3  uCool;     // white ink
uniform vec4  uCharge0;  // charged surface, left edge
uniform vec4  uCharge1;  // charged surface, handle end

uniform float uBurstTime[8];
uniform vec2  uBurstCenter[8];
uniform float uBurstGain[8];

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float cellSdf(vec2 p, vec2 center, float halfSize, float radius) {
  vec2 q = abs(p - center) - vec2(halfSize - radius);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  const float PITCH = 4.0;
  const float SIZE = 3.0;
  const float RADIUS = 0.9;
  const int BURSTS = 8;

  // Whole rows tile the bar height; the right edge absorbs the remainder.
  float pitch = uRes.y / max(round(uRes.y / PITCH), 1.0);
  float cellScale = pitch / PITCH;
  vec2 cell = floor(vUv / pitch);
  vec2 cellCenter = (cell + 0.5) * pitch;

  float halfSize = SIZE * 0.5 * cellScale;
  float radius = RADIUS * cellScale;
  float dist = cellSdf(vUv, cellCenter, halfSize, radius);
  float aa = min(fwidth(vUv.x), 1.5);
  float cellMask = 1.0 - smoothstep(-aa, aa, dist);

  if (cellMask <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  // Every cell has a stable identity, and the identity changes each press.
  float jitter = (hash21(cell + 41.7 + uSeed) - 0.5) * 0.2;
  float vary = 0.35 + 0.65 * hash21(cell + 13.7 + uSeed);

  float energy = 0.0;
  float charged = 0.0;

  for (int i = 0; i < BURSTS; i++) {
    float age = uTime - uBurstTime[i];
    if (age < 0.0 || age > 5.0) continue;

    float k = clamp(uBurstGain[i], 0.0, 1.0);
    vec2 originCell = floor(uBurstCenter[i] / pitch);
    float manhattan = abs(cell.x - originCell.x) + abs(cell.y - originCell.y);

    float range = mix(10.0, 55.0, k);
    float falloff = exp(-manhattan / (range * 0.85));
    float reach = exp(-max(manhattan - range, 0.0) * 0.12);
    float speed = mix(20.0, 36.0, k);
    float t = age - manhattan / speed - jitter;

    charged = max(charged, smoothstep(0.0, 0.15, t) * reach);
    if (t < 0.0) continue;

    // Only a subset of cells gets bright on any given pulse.
    float rank = hash21(cell + 7.3 + uSeed + uBurstTime[i]);
    if (rank > mix(0.30, 0.85, k)) continue;

    float head = 1.25 * exp(-t * 5.0);
    float body = 0.65 * exp(-t * mix(3.3, 0.77, k));
    energy += (head + body) * mix(0.55, 1.0, k) * falloff * reach * vary;
  }

  // Each cell has its own brightness lottery and slow drift.
  float lumA = hash21(cell + 8.8 + uSeed);
  float lumB = hash21(cell + 88.8 + uSeed);
  float drift = 0.5 + 0.5 * sin(uTime * 0.35 + lumA * 6.2832);
  float lum = pow(mix(lumA, lumB, drift), 1.9);
  float stream = 0.9 + 0.16 * sin(uTime * 1.3 + cell.x * 0.45 + lumB * 2.0);
  float e = clamp(energy, 0.0, 1.0) * uFade * mix(0.16, 1.0, lum) * stream;

  // The charged surface: left edge → handle, same wavefront, same envelope.
  float g = clamp(vUv.x / max(uPos * uRes.x, 1.0), 0.0, 1.0);
  vec3 chargeColor = mix(uCharge0.rgb, uCharge1.rgb, g);
  float chargeA = 0.85 * pow(g, 1.1) * charged * uFade * cellMask;

  // A discrete 5-step ramp; only the hottest cells breathe.
  float lv = step(0.04, e) + step(0.20, e) + step(0.40, e)
           + step(0.60, e) + step(0.80, e);
  float alpha = lv <= 0.0 ? 0.0 : mix(0.08, 0.85, (lv - 1.0) / 4.0);

  if (lv >= 5.0) {
    float period = 2.4 + 1.4 * hash21(cell + 3.1 + uSeed);
    float phase = hash21(cell + 5.5 + uSeed) * 6.2832;
    alpha *= 1.0 - 0.14 * (1.0 + sin(uTime * 6.2832 / period + phase));
  }

  vec3 ink = mix(uCool, uHot, pow(lv / 5.0, 1.4));
  float eA = alpha * cellMask;
  vec3 col = ink * eA + chargeColor * chargeA * (1.0 - eA);
  float a = eA + chargeA * (1.0 - eA);

  if (a <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  outColor = vec4(col, a);
}
`;

		class GridField {
			constructor(canvas) {
				this.canvas = canvas;
				this.gl = canvas.getContext('webgl2', {
					alpha: true,
					antialias: false,
					depth: false,
					stencil: false,
					premultipliedAlpha: true,
					powerPreference: 'low-power',
				});
				if (!this.gl) throw new Error('WebGL2 is not available');

				this.cssW = 1;
				this.cssH = 1;
				this.pxW = 1;
				this.pxH = 1;
				this.pos = 1;
				this.lit = false;
				this.fade = 0;
				this.seed = 0;
				this.slot = 0;
				this.pressElapsed = 0;
				this.nextBurst = 0;
				this.drawn = false;
				this.dpr = 1;

				this.burstTimes = new Float32Array(8);
				this.burstCenters = new Float32Array(16);
				this.burstGains = new Float32Array(8);
				this.burstTimes.fill(-1000);
				this.burstGains.fill(0);

				this._init();
				this.resize(1, 1, 1);
			}

			_compile(type, source) {
				const gl = this.gl;
				const shader = gl.createShader(type);
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
					const log = gl.getShaderInfoLog(shader);
					gl.deleteShader(shader);
					throw new Error('Grid shader compile failed: ' + log);
				}
				return shader;
			}

			_program(vsSource, fsSource) {
				const gl = this.gl;
				const program = gl.createProgram();
				const vs = this._compile(gl.VERTEX_SHADER, vsSource);
				const fs = this._compile(gl.FRAGMENT_SHADER, fsSource);
				gl.attachShader(program, vs);
				gl.attachShader(program, fs);
				gl.linkProgram(program);
				gl.deleteShader(vs);
				gl.deleteShader(fs);
				if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
					const log = gl.getProgramInfoLog(program);
					gl.deleteProgram(program);
					throw new Error('Grid program link failed: ' + log);
				}
				return program;
			}

			_init() {
				const gl = this.gl;
				gl.disable(gl.DEPTH_TEST);
				gl.disable(gl.CULL_FACE);
				gl.disable(gl.BLEND);
				gl.clearColor(0, 0, 0, 0);

				this.program = this._program(GRID_VS, GRID_FS);
				this.aPos = gl.getAttribLocation(this.program, 'aPos');

				this.u = {};
				for (const name of [
					'uRes', 'uTime', 'uFade', 'uPos', 'uSeed',
					'uHot', 'uCool', 'uCharge0', 'uCharge1',
					'uBurstTime[0]', 'uBurstCenter[0]', 'uBurstGain[0]',
				]) {
					this.u[name] = gl.getUniformLocation(this.program, name);
				}

				const buffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				gl.bufferData(
					gl.ARRAY_BUFFER,
					new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
					gl.STATIC_DRAW
				);
				this.buffer = buffer;

				gl.useProgram(this.program);
				gl.uniform3f(this.u.uHot, 0.627, 0.588, 0.922);
				gl.uniform3f(this.u.uCool, 1.0, 1.0, 1.0);
				gl.uniform4f(this.u.uCharge0, 0.62, 0.5, 0.92, 1.0);
				gl.uniform4f(this.u.uCharge1, 0.35, 0.25, 0.6, 1.0);
			}

			resize(cssWidth, cssHeight, dpr) {
				const gl = this.gl;
				if (!gl) return;
				const w = Math.max(1, cssWidth);
				const h = Math.max(1, cssHeight);
				const nextDpr = clamp(dpr || 1, 1, 2);
				const pxW = Math.max(1, Math.round(w * nextDpr));
				const pxH = Math.max(1, Math.round(h * nextDpr));

				if (this.cssW > 1) {
					const sx = w / this.cssW;
					const sy = h / this.cssH;
					for (let i = 0; i < 8; i += 1) {
						this.burstCenters[i * 2] *= sx;
						this.burstCenters[i * 2 + 1] *= sy;
					}
				}

				this.cssW = w;
				this.cssH = h;
				this.dpr = nextDpr;

				if (this.pxW === pxW && this.pxH === pxH) {
					this.drawn = false;
					return;
				}

				this.pxW = pxW;
				this.pxH = pxH;
				this.canvas.width = pxW;
				this.canvas.height = pxH;
				gl.viewport(0, 0, pxW, pxH);
				gl.clear(gl.COLOR_BUFFER_BIT);
				this.drawn = false;
			}

			setPos(pos) {
				this.pos = clamp(pos, 0.02, 1);
			}

			setLit(lit) {
				if (lit === this.lit) return;
				this.lit = lit;
				if (!lit) return;

				const now = performance.now() / 1000;
				this.seed = Math.random() * 512;
				this.burstTimes.fill(-1000);
				this.burstGains.fill(0);
				this.pressElapsed = 0;
				this.fade = 0;
				this.nextBurst = now;
				this.spawnBurst(now);
				this.nextBurst = now + 0.3 + Math.random() * 0.45;
			}

			spawnBurst(now) {
				const base = Math.min(
					1,
					(0.15 + 0.7 * this.pos) *
						(0.45 + 0.55 * Math.min(this.pressElapsed / 1.6, 1))
				);
				const gain = Math.min(1, base * (0.85 + Math.random() * 0.3));

				const i = this.slot;
				this.slot = (this.slot + 1) % 8;
				this.burstTimes[i] = now;
				this.burstCenters[i * 2] = this.pos * this.cssW;
				this.burstCenters[i * 2 + 1] = (0.35 + Math.random() * 0.3) * this.cssH;
				this.burstGains[i] = gain;
			}

			render(time, dt) {
				if (!this.gl) return;

				const targetLit = this.lit;
				if (targetLit) this.pressElapsed += dt;

				const rate = targetLit ? dt / 0.45 : dt / 0.85;
				this.fade = clamp(this.fade + (targetLit ? rate : -rate), 0, 1);

				if (targetLit) {
					while (time >= this.nextBurst) {
						this.spawnBurst(this.nextBurst);
						this.nextBurst += 0.3 + Math.random() * 0.45;
					}
				}

				if (this.fade <= 0.002 && !targetLit) {
					if (this.drawn) {
						this.gl.clear(this.gl.COLOR_BUFFER_BIT);
						this.drawn = false;
					}
					return;
				}

				this.draw(time);
				this.drawn = true;
			}

			draw(time) {
				const gl = this.gl;
				if (!gl || this.pxW < 1) return;

				gl.useProgram(this.program);
				gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
				gl.enableVertexAttribArray(this.aPos);
				gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

				gl.uniform2f(this.u.uRes, this.cssW, this.cssH);
				gl.uniform1f(this.u.uTime, time);
				gl.uniform1f(this.u.uFade, smooth(this.fade));
				gl.uniform1f(this.u.uPos, this.pos);
				gl.uniform1f(this.u.uSeed, this.seed);
				gl.uniform1fv(this.u['uBurstTime[0]'], this.burstTimes);
				gl.uniform2fv(this.u['uBurstCenter[0]'], this.burstCenters);
				gl.uniform1fv(this.u['uBurstGain[0]'], this.burstGains);

				gl.clear(gl.COLOR_BUFFER_BIT);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
			}

			dispose() {
				const gl = this.gl;
				if (!gl) return;
				try {
					gl.deleteProgram(this.program);
					gl.deleteBuffer(this.buffer);
					const lose = gl.getExtension('WEBGL_lose_context');
					if (lose) lose.loseContext();
				} catch (_error) {
					/* the context may already be gone */
				}
				this.gl = null;
			}
		}

		/* ================================================================
		   Styles — the reference stylesheet, namespaced
		   ================================================================ */

		const CSS = `
.ccs-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#b9b5ac);font-family:inherit;font-size:11px;line-height:1;letter-spacing:.002em;white-space:nowrap;cursor:pointer;transition:color .25s ease,border-color .25s ease,background .25s ease,box-shadow .25s ease}
.ccs-pill:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.2));color:var(--dsw-alias-label-primary,#f4f1eb)}
.ccs-pill:focus-visible{outline:2px solid rgba(160,150,235,.55);outline-offset:2px}
.ccs-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.055))}
.ccs-pill__gauge{width:12px;height:12px;opacity:.8;flex-shrink:0}
.ccs-pill__chevron{width:10px;height:10px;margin-left:1px;opacity:.55;flex-shrink:0;transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.ccs-pill[aria-expanded="true"] .ccs-pill__chevron{transform:rotate(180deg)}
.ccs-pill.is-ultra{border-color:rgba(160,150,235,.3);background:rgba(160,150,235,.09);color:#d5ceff;box-shadow:0 0 20px -9px rgba(160,150,235,.65)}
.ccs-pill.is-ultra .ccs-pill__gauge{color:#b9aeff;opacity:1}

.ccs-layer{position:absolute;bottom:calc(100% + 10px);right:8px;z-index:1200;display:flex;justify-content:flex-end;pointer-events:none}
.ccs-popover{position:relative;width:272px;padding:14px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:radial-gradient(120% 80% at 30% -20%,rgba(255,255,255,.035),transparent 60%),#20201f;box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 24px 60px -22px rgba(0,0,0,.95),0 4px 14px rgba(0,0,0,.35);color:#f4f1eb;font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;pointer-events:auto;color-scheme:dark;animation:ccs-fade-in .26s cubic-bezier(.2,.8,.2,1) both;transition:border-color .35s ease,box-shadow .35s ease;--ccs-muted:#8b877e;--ccs-text-2:#c9c5bc;--ccs-violet-bright:#b9aeff;--ccs-violet-deep:#6f5fd0;--ccs-warning:#d6a64a;--ccs-line:rgba(255,255,255,.09);--ccs-line-2:rgba(255,255,255,.14);--ccs-thumb-w:20px;--ccs-thumb-h:24px;--ccs-track-h:24px;--ccs-thumb-x:110px;--ccs-fill-end:120px;--ccs-ease-out:cubic-bezier(.2,.8,.2,1);--ccs-ease-overshoot:cubic-bezier(.34,1.3,.64,1)}
.ccs-popover *,.ccs-popover *::before,.ccs-popover *::after{box-sizing:border-box}
.ccs-popover.is-ultra{border-color:rgba(160,150,235,.28);background:radial-gradient(100% 62% at 72% -8%,rgba(160,150,235,.11),transparent 62%),radial-gradient(120% 80% at 30% -20%,rgba(255,255,255,.035),transparent 60%),#20201f;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 60px -22px rgba(0,0,0,.95),0 0 46px -14px rgba(160,150,235,.45)}
.ccs-popover__head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:18px;margin-bottom:12px}
.ccs-popover__status{display:flex;align-items:center;gap:8px;min-width:0}
.ccs-popover__title{color:var(--ccs-muted);font-size:12px;font-weight:500;letter-spacing:.005em}
.ccs-level{color:#f4f1eb;font-size:12.5px;font-weight:560;letter-spacing:-.005em;text-align:left;white-space:nowrap;transition:color .25s ease,text-shadow .25s ease}
.ccs-popover.is-ultra .ccs-level{color:var(--ccs-violet-bright);text-shadow:0 0 14px rgba(160,150,235,.5)}
.ccs-help{position:relative;width:16px;height:16px;padding:0;display:grid;place-items:center;border:1px solid var(--ccs-line-2);border-radius:50%;background:transparent;color:var(--ccs-muted);font-family:inherit;font-size:9px;font-weight:560;line-height:1;cursor:help;transition:color .2s ease,border-color .2s ease}
.ccs-help:hover,.ccs-help:focus-visible{color:#f4f1eb;border-color:rgba(255,255,255,.3);outline:none}
.ccs-help::after{content:attr(data-tip);position:absolute;z-index:20;bottom:calc(100% + 8px);right:-2px;width:192px;padding:8px 9px;border:1px solid var(--ccs-line);border-radius:8px;background:#151514;box-shadow:0 12px 30px -10px rgba(0,0,0,.9);color:var(--ccs-text-2);font-size:10.5px;font-weight:400;line-height:1.45;letter-spacing:0;text-align:left;white-space:normal;opacity:0;visibility:hidden;transform:translateY(3px);pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility .16s}
.ccs-help:hover::after,.ccs-help:focus-visible::after{opacity:1;visibility:visible;transform:translateY(0)}
.ccs-ends{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 7px;color:var(--ccs-muted);font-size:11px;letter-spacing:.005em}
.ccs-slider{position:relative;width:100%;height:30px;display:flex;align-items:center;outline:none;cursor:pointer;touch-action:none}
.ccs-track{position:relative;width:100%;height:var(--ccs-track-h);border-radius:4px;background:rgba(255,255,255,.1);transition:background .2s ease}
.ccs-slider:hover .ccs-track{background:rgba(255,255,255,.12)}
.ccs-fill{position:absolute;inset:0;z-index:1;pointer-events:none;clip-path:inset(0 calc(100% - var(--ccs-fill-end)) 0 0 round 4px)}
.ccs-fill__inner{position:absolute;inset:0;border-radius:4px;background:rgba(255,255,255,.26);overflow:hidden;isolation:isolate;transition:background .4s ease}
.ccs-popover.is-ultra .ccs-fill__inner{background:linear-gradient(90deg,rgba(255,255,255,.26) 0%,rgba(160,150,235,.2) 55%,rgba(160,150,235,.32) 100%)}
.ccs-fill__inner::after{content:"";position:absolute;inset:0;opacity:0;pointer-events:none}
.ccs-grid{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:.9;mix-blend-mode:plus-lighter;-webkit-mask-image:linear-gradient(to right,transparent 0%,#000 45%);mask-image:linear-gradient(to right,transparent 0%,#000 45%)}
.ccs-stops{position:absolute;inset:0;z-index:2;pointer-events:none}
.ccs-stop{position:absolute;top:50%;width:22px;height:30px;padding:0;border:0;border-radius:4px;background:transparent;display:grid;place-items:center;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer}
.ccs-stop__dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.28);pointer-events:none;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}
.ccs-stop:hover .ccs-stop__dot{background:rgba(255,255,255,.65);transform:scale(1.35)}
.ccs-thumb{position:absolute;z-index:3;top:0;left:var(--ccs-thumb-x);width:var(--ccs-thumb-w);height:var(--ccs-thumb-h);border-radius:4px;background:linear-gradient(180deg,#fbfaf6 0%,#eae7df 100%);box-shadow:0 0 0 1px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.45);pointer-events:auto;cursor:grab;transition:transform .12s var(--ccs-ease-overshoot),box-shadow .3s ease}
.ccs-slider.is-dragging .ccs-thumb{transform:scale(1.06);cursor:grabbing}
.ccs-popover.is-ultra .ccs-thumb{box-shadow:0 0 0 1px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.45),0 0 22px rgba(160,150,235,.5)}
.ccs-slider:focus-visible .ccs-thumb{outline:2px solid rgba(160,150,235,.65);outline-offset:2px}
.ccs-slider.no-ring:focus-visible .ccs-thumb{outline:none}
.ccs-desc{margin:10px 2px 0;min-height:34px;color:var(--ccs-muted);font-size:11.5px;line-height:1.45;letter-spacing:.002em}
.ccs-desc.is-warning{color:var(--ccs-warning)}
.ccs-desc.is-warning::before{content:"!";display:inline-grid;place-items:center;width:11px;height:11px;margin-right:5px;border:1px solid currentColor;border-radius:50%;font-size:8px;font-weight:600;line-height:1;vertical-align:1px}
.ccs-desc.is-note{margin-top:4px;min-height:0}
.ccs-toggleRow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)}
.ccs-toggleRow__copy{min-width:0}
.ccs-toggleRow__label{display:block;color:var(--ccs-text-2);font-size:12px;font-weight:500;letter-spacing:-.005em;cursor:pointer;transition:color .25s ease}
.ccs-popover.is-ultra .ccs-toggleRow__label{color:var(--ccs-violet-bright)}
.ccs-toggleRow__desc{margin:2px 0 0;color:var(--ccs-muted);font-size:10.5px;line-height:1.4}
.ccs-switch{position:relative;flex-shrink:0;width:30px;height:18px;cursor:pointer}
.ccs-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.ccs-switch__track{display:block;width:30px;height:18px;border-radius:999px;background:rgba(255,255,255,.14);pointer-events:none;transition:background .2s ease,box-shadow .2s ease}
.ccs-switch__knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#f7f5ef;box-shadow:0 1px 2px rgba(0,0,0,.45);transition:transform .2s var(--ccs-ease-overshoot)}
.ccs-switch input:checked+.ccs-switch__track{background:var(--ccs-violet-deep);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.ccs-switch input:checked+.ccs-switch__track .ccs-switch__knob{transform:translateX(12px)}
.ccs-switch input:focus-visible+.ccs-switch__track{outline:2px solid rgba(160,150,235,.55);outline-offset:2px}
.ccs-no-webgl .ccs-grid{display:none}
.ccs-no-webgl .ccs-fill__inner{background:rgba(255,255,255,.26)}
.ccs-no-webgl.ccs-popover.is-ultra .ccs-fill__inner::after{opacity:.65;background:radial-gradient(circle at 1px 1px,rgba(255,255,255,.78) .7px,transparent 1.15px) 0 0/4px 4px,linear-gradient(90deg,#8f7ee0 0%,#5b47a6 55%,#46347f 100%);mix-blend-mode:plus-lighter;-webkit-mask-image:linear-gradient(to right,transparent 0%,#000 60%);mask-image:linear-gradient(to right,transparent 0%,#000 60%)}
@keyframes ccs-fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@container (width<=560px){.ccs-pill__text{display:none}}
@media (prefers-reduced-motion: reduce){
.ccs-popover{animation:none}
.ccs-thumb,.ccs-switch__knob,.ccs-pill,.ccs-stop__dot,.ccs-help,.ccs-help::after{transition-duration:.01ms}
}
`;

		/**
		 * Insert this package's stylesheet. The module loader claims untagged
		 * style tags created while the factory materialises and removes them with
		 * the plugin, so no manual cleanup is needed.
		 */
		function insertStyles(css) {
			if (typeof document === 'undefined') return;
			const tag = document.createElement('style');
			tag.setAttribute('data-plugin-css', PKG_ID);
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		insertStyles(CSS);

		/* ================================================================
		   Panel controller shared by the pill, the panel and the interceptor
		   ================================================================ */

		function createController() {
			const listeners = new Set();
			let state = { open: false, anchor: null, rect: null, version: 0 };
			const emit = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch (error) {
						console.error('[' + PKG_ID + '] listener failed:', error);
					}
				}
			};
			return {
				getSnapshot() {
					return state;
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				open(anchor, rect) {
					state = {
						open: true,
						anchor: anchor || null,
						rect: rect || null,
						version: state.version + 1,
					};
					emit();
				},
				close() {
					if (!state.open) return;
					state = { open: false, anchor: null, rect: null, version: state.version + 1 };
					emit();
				},
				toggle(anchor, rect) {
					if (state.open) this.close();
					else this.open(anchor, rect);
				},
				touch() {
					state = {
						open: state.open,
						anchor: state.anchor,
						rect: state.rect,
						version: state.version + 1,
					};
					emit();
				},
			};
		}

		/** Subscribe a component to a bare snapshot store. */
		function useSnapshot(store) {
			const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
			useEffect(() => {
				let alive = true;
				const read = () => {
					if (alive) setSnapshot(store.getSnapshot());
				};
				read();
				const stop = store.subscribe(read);
				return () => {
					alive = false;
					stop();
				};
			}, [store]);
			return snapshot;
		}

		/* ================================================================
		   Writing the effort
		   ================================================================ */

		/**
		 * Submit one presentation level as a reasoning effort.
		 * @param {object} directory - session model directory.
		 * @param {object} view - `describe()` result.
		 * @param {number} level - presentation level, 0..4.
		 */
		function writeLevel(directory, view, level) {
			if (!view.usable || !view.current) return;
			const index = view.map[level];
			const id = view.ids[index];
			if (!id) return;
			if (view.current.reasoningEffort === id) return;
			const selection = {
				provider: view.current.provider,
				model: view.current.model,
				reasoningEffort: id,
			};
			Promise.resolve()
				.then(() => directory.select(selection))
				.then((result) => {
					if (result && result.ok === false) {
						console.warn('[' + PKG_ID + '] effort write rejected:', result.error);
					}
				})
				.catch((error) => {
					console.warn('[' + PKG_ID + '] effort write failed:', error);
				});
		}

		/* ================================================================
		   Composer pill
		   ================================================================ */

		const GAUGE_ICON = h(
			'svg',
			{ className: 'ccs-pill__gauge', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
			h('path', {
				d: 'M2.4 8h11.2',
				stroke: 'currentColor',
				strokeWidth: 1.4,
				strokeLinecap: 'round',
			}),
			h('circle', { cx: 10.2, cy: 8, r: 2.1, fill: 'currentColor' })
		);

		const CHEVRON_ICON = h(
			'svg',
			{ className: 'ccs-pill__chevron', viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true },
			h('path', {
				d: 'm2.5 7.5 3.5-3 3.5 3',
				stroke: 'currentColor',
				strokeWidth: 1.3,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
			})
		);

		function EffortPill(props) {
			const { sessionId, controller, useEffortDirectory, t } = props;
			const snapshot = useEffortDirectory((state) => state);
			const panel = useSnapshot(controller);
			const view = describe(snapshot);
			const buttonRef = useRef(null);

			// Remember the live session so the menu-row interceptor knows where to write.
			useEffect(() => {
				activeSessionId = sessionId;
				return () => {
					if (activeSessionId === sessionId) activeSessionId = null;
				};
			}, [sessionId]);

			if (!view.usable) {
				// Still resolving the session's model directory: stay clickable so the
				// popover can say so instead of looking dead.
				if (!view.loading) return null;
				return h(
					'button',
					{
						ref: buttonRef,
						type: 'button',
						className: 'ccs-pill ccs-pill--pending',
						'data-ccs-root': '',
						'aria-haspopup': 'dialog',
						'aria-expanded': panel.open ? 'true' : 'false',
						'aria-label': 'Effort: ' + t('loading'),
						title: t('loading'),
						onClick: (event) => {
							event.stopPropagation();
							const element = buttonRef.current;
							controller.toggle(element, element ? element.getBoundingClientRect() : null);
						},
					},
					GAUGE_ICON,
					h('span', { className: 'ccs-pill__text' }, 'Effort: …'),
					CHEVRON_ICON
				);
			}

			const ultra = readFlag(sessionId);
			const level = levelForEffort(view.ids, view.map, view.effective, ultra);
			const name = LEVELS[level].name;
			const isUltra = level === ULTRA;

			return h(
				'button',
				{
					ref: buttonRef,
					type: 'button',
					className: 'ccs-pill' + (isUltra ? ' is-ultra' : ''),
					'data-ccs-root': '',
					'aria-haspopup': 'dialog',
					'aria-expanded': panel.open ? 'true' : 'false',
					'aria-label': 'Effort: ' + name + '. Open effort settings.',
					title: 'Effort: ' + name,
					onClick: (event) => {
						event.stopPropagation();
						const element = buttonRef.current;
						controller.toggle(element, element ? element.getBoundingClientRect() : null);
					},
				},
				GAUGE_ICON,
				h('span', { className: 'ccs-pill__text' }, 'Effort: ' + name),
				CHEVRON_ICON
			);
		}

		/* ================================================================
		   Effort popover
		   ================================================================ */

		function EffortPanel(props) {
			const { controller } = props;
			const panel = useSnapshot(controller);
			if (!panel.open) return null;
			return h(PanelBody, props);
		}

		function PanelBody(props) {
			const { sessionId, controller, useEffortDirectory, t } = props;
			const snapshot = useEffortDirectory((state) => state);
			const view = describe(snapshot);
			const placement = useControllerAnchor(controller);

			const popoverRef = useRef(null);
			const layerRef = useRef(null);
			const trackRef = useRef(null);
			const thumbRef = useRef(null);
			const canvasRef = useRef(null);
			const sliderRef = useRef(null);
			const labelRef = useRef(null);

			const [geo, setGeo] = useState({ width: 1, height: 1, thumbWidth: 20, travel: 1 });
			const [level, setLevel] = useState(() =>
				view.usable
					? levelForEffort(view.ids, view.map, view.effective, readFlag(sessionId))
					: ULTRA
			);
			const [pos, setPos] = useState(() => level / (N - 1));
			const [noWebgl, setNoWebgl] = useState(reduceMotion);
			const [dragging, setDragging] = useState(false);

			const geoRef = useRef(geo);
			const posRef = useRef(pos);
			const levelRef = useRef(level);
			const springingRef = useRef(false);
			const targetRef = useRef(pos);
			const velocityRef = useRef(0);
			const dragRef = useRef({ active: false, pointerId: null, offset: 0 });
			const gridRef = useRef(null);
			const viewRef = useRef(view);
			const levelSignature = view.ids.join(',') + '|' + String(view.effective);

			geoRef.current = geo;
			posRef.current = pos;
			levelRef.current = level;
			viewRef.current = view;

			const setLevelFromPos = useCallback((next) => {
				const candidate = clamp(Math.round(next * (N - 1)), 0, ULTRA);
				if (candidate === levelRef.current) return;
				setLevel(candidate);
				levelRef.current = candidate;
			}, []);

			const animateLabel = useCallback(() => {
				const element = labelRef.current;
				if (!element || reduceMotion || !element.animate) return;
				element.animate(
					[
						{ opacity: 0.15, transform: 'translateY(4px)', filter: 'blur(2px)' },
						{ opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
					],
					{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
				);
			}, []);

			/** Move the thumb to a level and (optionally) submit it. */
			const settle = useCallback(
				(nextLevel) => {
					const clamped = clamp(Math.round(nextLevel), 0, ULTRA);
					if (clamped !== levelRef.current) animateLabel();
					setLevel(clamped);
					levelRef.current = clamped;
					const target = clamped / (N - 1);
					targetRef.current = target;
					velocityRef.current = 0;
					if (reduceMotion) {
						springingRef.current = false;
						setPos(target);
						posRef.current = target;
					} else {
						springingRef.current = true;
					}
					const on = clamped === ULTRA;
					if (readFlag(sessionId) !== on) controller.touch();
					writeFlag(sessionId, on);
					const current = viewRef.current;
					const directory = typeof props.getDirectory === 'function' ? props.getDirectory() : null;
					if (current.usable && directory) writeLevel(directory, current, clamped);
				},
				[animateLabel, controller, props.getDirectory, sessionId]
			);

			const settleRef = useRef(settle);
			settleRef.current = settle;

			/* --- geometry ------------------------------------------------- */

			useLayoutEffect(() => {
				const track = trackRef.current;
				const thumb = thumbRef.current;
				if (!track || !thumb) return undefined;
				const measure = () => {
					const width = track.clientWidth;
					const height = track.clientHeight;
					if (width < 2 || height < 2) return;
					const thumbWidth = thumb.offsetWidth || 20;
					setGeo((previous) => {
						const travel = Math.max(1, width - thumbWidth);
						if (
							previous.width === width &&
							previous.height === height &&
							previous.thumbWidth === thumbWidth
						) {
							return previous;
						}
						return { width, height, thumbWidth, travel };
					});
				};
				measure();
				let observer = null;
				if (typeof ResizeObserver === 'function') {
					observer = new ResizeObserver(measure);
					observer.observe(track);
				}
				window.addEventListener('resize', measure);
				return () => {
					if (observer) observer.disconnect();
					window.removeEventListener('resize', measure);
				};
			}, []);

			/* --- initial level -------------------------------------------- */

			useEffect(() => {
				if (!view.usable) return;
				// A live drag or spring owns the thumb; the written effort is
				// already the level the user picked, so there is nothing to adopt.
				if (springingRef.current || dragRef.current.active) return;
				const next = levelForEffort(view.ids, view.map, view.effective, readFlag(sessionId));
				setLevel(next);
				levelRef.current = next;
				const target = next / (N - 1);
				setPos(target);
				posRef.current = target;
				targetRef.current = target;
				// Re-sync only when the model ladder or the persisted effort changes.
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [levelSignature, view.usable, sessionId]);

			/* --- anchor placement ----------------------------------------- */

			useLayoutEffect(() => {
				const layer = layerRef.current;
				const parent = layer && layer.parentElement;
				if (!layer || !parent) return undefined;
				const place = () => {
					const parentRect = parent.getBoundingClientRect();
					const live =
						placement.anchor && placement.anchor.isConnected
							? placement.anchor.getBoundingClientRect()
							: null;
					const rect =
						live && (live.width > 0 || live.height > 0) ? live : placement.rect;
					let right = 8;
					if (rect && (rect.width > 0 || rect.height > 0)) {
						right = clamp(parentRect.right - rect.right, 8, Math.max(8, parentRect.width - 32));
					}
					layer.style.right = right + 'px';
				};
				place();
				window.addEventListener('resize', place);
				return () => window.removeEventListener('resize', place);
			}, [placement.anchor, placement.rect]);

			/* --- animation loop: spring + grid ---------------------------- */

			useEffect(() => {
				if (!view.usable || reduceMotion) return undefined;
				const canvas = canvasRef.current;
				if (!canvas) return undefined;
				let grid = null;
				try {
					grid = new GridField(canvas);
				} catch (error) {
					console.warn('[' + PKG_ID + '] WebGL2 unavailable — using static grid.', error);
					setNoWebgl(true);
					return undefined;
				}
				gridRef.current = grid;
				setNoWebgl(false);
				const startGeo = geoRef.current;
				if (startGeo.width > 1) {
					grid.resize(startGeo.width, startGeo.height, Math.min(window.devicePixelRatio || 1, 2));
				}
				grid.setLit(levelRef.current === ULTRA);

				let frame = 0;
				let last = performance.now();
				const loop = (now) => {
					const dt = clamp((now - last) / 1000, 0, 0.05);
					last = now;

					if (springingRef.current) {
						const steps = Math.max(1, Math.ceil(dt / 0.006));
						const step = dt / steps;
						let value = posRef.current;
						let velocity = velocityRef.current;
						for (let i = 0; i < steps; i += 1) {
							const acceleration =
								520 * (targetRef.current - value) - 38 * velocity;
							velocity += acceleration * step;
							value += velocity * step;
							if (value <= 0) {
								value = 0;
								if (velocity < 0) velocity = 0;
							} else if (value >= 1) {
								value = 1;
								if (velocity > 0) velocity = 0;
							}
							if (
								Math.abs(targetRef.current - value) < 0.0004 &&
								Math.abs(velocity) < 0.02
							) {
								value = targetRef.current;
								velocity = 0;
								springingRef.current = false;
								break;
							}
						}
						velocityRef.current = velocity;
						posRef.current = value;
						setPos(value);
					}

					const currentGeo = geoRef.current;
					if (currentGeo.width > 1) {
						const fillEnd = currentGeo.thumbWidth / 2 + posRef.current * currentGeo.travel;
						grid.setPos(fillEnd / currentGeo.width);
					}
					grid.render(now / 1000, dt);
					frame = window.requestAnimationFrame(loop);
				};
				frame = window.requestAnimationFrame(loop);
				return () => {
					window.cancelAnimationFrame(frame);
					grid.dispose();
					gridRef.current = null;
				};
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [view.usable]);

			useEffect(() => {
				const grid = gridRef.current;
				if (!grid || geo.width < 2) return;
				grid.resize(geo.width, geo.height, Math.min(window.devicePixelRatio || 1, 2));
			}, [geo.width, geo.height]);

			useEffect(() => {
				const grid = gridRef.current;
				if (grid) grid.setLit(level === ULTRA);
			}, [level]);

			/* --- pointer -------------------------------------------------- */

			const positionFromClientX = useCallback((clientX) => {
				const track = trackRef.current;
				if (!track) return posRef.current;
				const rect = track.getBoundingClientRect();
				const currentGeo = geoRef.current;
				const x = clientX - rect.left - dragRef.current.offset;
				return clamp((x - currentGeo.thumbWidth / 2) / currentGeo.travel, 0, 1);
			}, []);

			const onPointerDown = useCallback(
				(event) => {
					if (event.pointerType === 'mouse' && event.button !== 0) return;
					if (!viewRef.current.usable) return;
					if (event.target && event.target.closest && event.target.closest('.ccs-switch')) return;
					event.preventDefault();
					springingRef.current = false;
					velocityRef.current = 0;
					dragRef.current = { active: true, pointerId: event.pointerId, offset: 0 };
					setDragging(true);
					const slider = sliderRef.current;
					if (slider) {
						try {
							slider.focus({ preventScroll: true });
							slider.classList.add('no-ring');
							slider.setPointerCapture(event.pointerId);
						} catch (_error) {
							/* ignore */
						}
					}
					const track = trackRef.current;
					if (track) {
						const rect = track.getBoundingClientRect();
						const currentGeo = geoRef.current;
						const center =
							rect.left + currentGeo.thumbWidth / 2 + posRef.current * currentGeo.travel;
						const offset = event.clientX - center;
						dragRef.current.offset =
							Math.abs(offset) <= (currentGeo.thumbWidth * 0.7) / 2 ? offset : 0;
					}
					const next = positionFromClientX(event.clientX);
					posRef.current = next;
					setPos(next);
					setLevelFromPos(next);
				},
				[positionFromClientX, setLevelFromPos]
			);

			const onPointerMove = useCallback(
				(event) => {
					const drag = dragRef.current;
					if (!drag.active || event.pointerId !== drag.pointerId) return;
					event.preventDefault();
					const next = positionFromClientX(event.clientX);
					posRef.current = next;
					setPos(next);
					setLevelFromPos(next);
				},
				[positionFromClientX, setLevelFromPos]
			);

			const endDrag = useCallback(
				(event) => {
					const drag = dragRef.current;
					if (!drag.active) return;
					if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
					drag.active = false;
					setDragging(false);
					const slider = sliderRef.current;
					if (slider && drag.pointerId !== null) {
						try {
							if (slider.hasPointerCapture && slider.hasPointerCapture(drag.pointerId)) {
								slider.releasePointerCapture(drag.pointerId);
							}
						} catch (_error) {
							/* ignore */
						}
					}
					drag.pointerId = null;
					drag.offset = 0;
					settleRef.current(levelRef.current);
				},
				[]
			);

			useEffect(() => {
				const onUp = (event) => {
					if (dragRef.current.active) endDrag(event);
				};
				window.addEventListener('pointerup', onUp);
				window.addEventListener('pointercancel', onUp);
				return () => {
					window.removeEventListener('pointerup', onUp);
					window.removeEventListener('pointercancel', onUp);
				};
			}, [endDrag]);

			/* --- keyboard ------------------------------------------------- */

			const onKeyDown = useCallback(
				(event) => {
					if (!viewRef.current.usable) return;
					let next = levelRef.current;
					let handled = true;
					switch (event.key) {
						case 'ArrowRight':
						case 'ArrowUp':
						case 'PageUp':
							next += 1;
							break;
						case 'ArrowLeft':
						case 'ArrowDown':
						case 'PageDown':
							next -= 1;
							break;
						case 'Home':
							next = 0;
							break;
						case 'End':
							next = ULTRA;
							break;
						case 'Enter':
						case ' ':
							event.preventDefault();
							settleRef.current(levelRef.current);
							return;
						default:
							handled = false;
					}
					if (!handled) return;
					event.preventDefault();
					if (sliderRef.current) sliderRef.current.classList.remove('no-ring');
					settleRef.current(next);
				},
				[]
			);

			/* --- render --------------------------------------------------- */

			const ultraMode = level === ULTRA;
			const travel = Math.max(1, geo.width - geo.thumbWidth);
			const thumbX = pos * travel;
			const fillEnd = geo.thumbWidth / 2 + pos * travel;
			const info = LEVELS[level];
			const description = info.warning || info.desc;

			if (!view.usable) {
				const note = view.loading ? t('loading') : t('unsupported');
				return h(
					'div',
					{ ref: layerRef, className: 'ccs-layer', 'data-ccs-root': '', 'data-ccs-panel': '' },
					h(
						'section',
						{ className: 'ccs-popover', role: 'dialog', 'aria-label': 'Effort settings' },
						h(
							'div',
							{ className: 'ccs-popover__head' },
							h(
								'div',
								{ className: 'ccs-popover__status' },
								h('span', { className: 'ccs-popover__title' }, 'Effort'),
								h('span', { className: 'ccs-level' }, view.loading ? '…' : '—')
							),
							h('button', {
								type: 'button',
								className: 'ccs-help',
								'aria-label': t('help'),
								'data-tip': note,
							}, '?')
						),
						h('p', { className: 'ccs-desc is-note' }, note)
					)
				);
			}

			const stops = [];
			for (let index = 0; index < N; index += 1) {
				const left = geo.thumbWidth / 2 + (index * travel) / (N - 1);
				stops.push(
					h(
						'span',
						{
							key: 'stop-' + index,
							className: 'ccs-stop',
							style: { left: left.toFixed(2) + 'px' },
							'aria-hidden': 'true',
						},
						h('span', { className: 'ccs-stop__dot' })
					)
				);
			}

			const popoverClass =
				'ccs-popover' +
				(ultraMode ? ' is-ultra' : '') +
				(noWebgl ? ' ccs-no-webgl' : '');

			return h(
				'div',
				{
					ref: layerRef,
					className: 'ccs-layer',
					'data-ccs-root': '',
					'data-ccs-panel': '',
				},
				h(
					'section',
					{
						ref: popoverRef,
						className: popoverClass,
						role: 'dialog',
						'aria-label': 'Effort settings',
						style: {
							'--ccs-thumb-x': thumbX.toFixed(2) + 'px',
							'--ccs-fill-end': fillEnd.toFixed(2) + 'px',
						},
					},
					h(
						'div',
						{ className: 'ccs-popover__head' },
						h(
							'div',
							{ className: 'ccs-popover__status' },
							h('span', { className: 'ccs-popover__title' }, 'Effort'),
							h('span', { ref: labelRef, className: 'ccs-level' }, info.name)
						),
						h('button', {
							type: 'button',
							className: 'ccs-help',
							'aria-label': 'About effort',
							'data-tip':
								'Faster on the left, smarter on the right. Choose Ultracode to add dynamic workflows.',
						}, '?')
					),
					h(
						'div',
						{ className: 'ccs-ends', 'aria-hidden': 'true' },
						h('span', null, 'Faster'),
						h('span', null, 'Smarter')
					),
					h(
						'div',
						{
							ref: sliderRef,
							className: 'ccs-slider' + (dragging ? ' is-dragging' : ''),
							role: 'slider',
							tabIndex: 0,
							'aria-label': 'Effort',
							'aria-valuemin': 0,
							'aria-valuemax': ULTRA,
							'aria-valuenow': level,
							'aria-valuetext': info.name + '. ' + description,
							onPointerDown,
							onPointerMove,
							onPointerUp: endDrag,
							onPointerCancel: endDrag,
							onKeyDown,
							onBlur: () => {
								if (sliderRef.current) sliderRef.current.classList.remove('no-ring');
							},
						},
						h(
							'div',
							{ ref: trackRef, className: 'ccs-track' },
							h(
								'div',
								{ className: 'ccs-fill', 'aria-hidden': 'true' },
								h(
									'div',
									{ className: 'ccs-fill__inner' },
									h('canvas', { ref: canvasRef, className: 'ccs-grid', 'aria-hidden': 'true' })
								)
							),
							h('div', { className: 'ccs-stops', 'aria-hidden': 'true' }, stops),
							h('div', { ref: thumbRef, className: 'ccs-thumb', 'aria-hidden': 'true' })
						)
					),
					h(
						'p',
						{ className: 'ccs-desc' + (info.warning ? ' is-warning' : '') },
						description
					),
					h(
						'div',
						{ className: 'ccs-toggleRow' },
						h(
							'div',
							{ className: 'ccs-toggleRow__copy' },
							h(
								'label',
								{ className: 'ccs-toggleRow__label', htmlFor: 'ccs-ultra-toggle' },
								'Ultracode'
							),
							h(
								'p',
								{ className: 'ccs-toggleRow__desc' },
								'Standing dynamic-workflow orchestration for this session.'
							)
						),
						h(
							'label',
							{ className: 'ccs-switch' },
							h('input', {
								id: 'ccs-ultra-toggle',
								type: 'checkbox',
								role: 'switch',
								checked: ultraMode,
								onChange: () => settle(ultraMode ? MAX_LEVEL : ULTRA),
							}),
							h(
								'span',
								{ className: 'ccs-switch__track', 'aria-hidden': 'true' },
								h('span', { className: 'ccs-switch__knob' })
							)
						)
					)
				)
			);
		}

		/** Placement source: the live anchor element and its last measured box. */
		function useControllerAnchor(controller) {
			const snapshot = useSnapshot(controller);
			return { anchor: snapshot.anchor, rect: snapshot.rect };
		}

		/* ================================================================
		   Plugin
		   ================================================================ */

		/**
		 * Retry budget for resolving a session's model directory. The slot kit
		 * caches one injected face per binding, so a lookup that fails during the
		 * first cold render — before the session has a scope and a binding —
		 * would otherwise freeze the control for the life of the page.
		 */
		const DIRECTORY_RETRY_LIMIT = 40;
		const DIRECTORY_RETRY_INTERVAL_MS = 300;

		/**
		 * A store that keeps trying to reach the session's shared model directory
		 * and then proxies it: `null` until the first successful lookup, the real
		 * snapshot afterwards. Subscribing starts the retry loop, so a pill that
		 * mounted too early still becomes usable without a reload.
		 * @param {() => object|null} resolve - one lookup attempt.
		 * @returns {{store: {getSnapshot: () => object|null, subscribe: (fn: () => void) => () => void}, directory: () => object|null, dispose: () => void}}
		 */
		function createDirectoryProxy(resolve) {
			let target = null;
			let snapshot = null;
			let stopTarget = null;
			let timer = null;
			let attempts = 0;
			let disposed = false;
			const listeners = new Set();

			const emit = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch (error) {
						console.error('[' + PKG_ID + '] directory listener failed:', error);
					}
				}
			};

			const stopTimer = () => {
				if (timer === null) return;
				clearInterval(timer);
				timer = null;
			};

			const settle = () => {
				if (disposed || target !== null) return;
				attempts += 1;
				let next = null;
				try {
					next = resolve();
				} catch (_error) {
					next = null;
				}
				if (!next) {
					if (attempts >= DIRECTORY_RETRY_LIMIT) {
						stopTimer();
						emit();
					}
					return;
				}
				stopTimer();
				target = next;
				try {
					snapshot = next.store.getSnapshot();
				} catch (_error) {
					snapshot = null;
				}
				stopTarget = next.store.subscribe(() => {
					try {
						snapshot = next.store.getSnapshot();
					} catch (_error) {
						snapshot = null;
					}
					emit();
				});
				// The shipped menu loads on open; doing it here means the pill and the
				// popover show real levels as soon as the directory is reachable.
				try {
					Promise.resolve(next.load()).catch(() => {});
				} catch (_error) {
					/* keep the snapshot we have */
				}
				emit();
			};

			const startTimer = () => {
				if (disposed || target !== null || timer !== null) return;
				if (attempts >= DIRECTORY_RETRY_LIMIT) return;
				timer = setInterval(settle, DIRECTORY_RETRY_INTERVAL_MS);
			};

			return {
				store: {
					getSnapshot: () => (target === null ? null : snapshot),
					subscribe(listener) {
						listeners.add(listener);
						settle();
						startTimer();
						return () => {
							listeners.delete(listener);
						};
					},
				},
				directory: () => target,
				dispose() {
					disposed = true;
					stopTimer();
					if (typeof stopTarget === 'function') stopTarget();
					stopTarget = null;
					listeners.clear();
				},
			};
		}

		/** Text shown by the pill while the catalog is still loading. */
		const LOCALE_EN = {
			loading: 'Loading reasoning levels…',
			unsupported: 'This model provides no reasoning levels.',
			help: 'About effort',
		};
		const LOCALE_ZH = {
			loading: '正在读取推理等级…',
			unsupported: '当前模型不提供推理等级。',
			help: '关于推理等级',
		};

		/** Effort row labels used by the shipped model menu. */
		const EFFORT_ROW_PREFIXES = ['Effort', '推理等级'];

		let activeSessionId = null;

		const inject = ['slots', 'locale', 'modelDirectories'];

		function apply(ctx) {
			const directories = ctx.get('modelDirectories');
			if (directories === undefined) {
				console.warn('[' + PKG_ID + '] modelDirectories service unavailable — slider disabled');
				return;
			}

			ctx.effect(
				() => ctx.locale.register(NS, { en: LOCALE_EN, zh: LOCALE_ZH }),
				'cc-effort-slider: dictionaries'
			);

			const controller = createController();

			/** One retrying proxy per session, shared by the pill and the popover. */
			const proxies = new Map();
			const proxyFor = (sessionId) => {
				const key = String(sessionId);
				const existing = proxies.get(key);
				if (existing !== undefined) return existing;
				const proxy = createDirectoryProxy(() => directories.directoryFor(sessionId));
				proxies.set(key, proxy);
				return proxy;
			};

			ctx.effect(() => () => {
				for (const proxy of proxies.values()) proxy.dispose();
				proxies.clear();
			}, 'cc-effort-slider: directory proxies');

			ctx.slots.inject('conversation.input.right', () =>
				ctx.slots.register(
					{
						name: 'conversation.input.right',
						id: 'cc-effort-slider',
						order: 40,
						locale: NS,
						inject: (sessionId) => {
							const proxy = proxyFor(sessionId);
							// A slot inject face spreads every non-`hooks` key as props.
							return {
								hooks: { effortDirectory: proxy.store },
								sessionId,
								controller,
								getDirectory: proxy.directory,
							};
						},
					},
					EffortPill
				)
			);

			ctx.slots.inject('conversation.input.overlay', () =>
				ctx.slots.register(
					{
						name: 'conversation.input.overlay',
						id: 'cc-effort-panel',
						order: 60,
						locale: NS,
						inject: (sessionId) => {
							const proxy = proxyFor(sessionId);
							// A slot inject face spreads every non-`hooks` key as props.
							return {
								hooks: { effortDirectory: proxy.store },
								sessionId,
								controller,
								getDirectory: proxy.directory,
							};
						},
					},
					EffortPanel
				)
			);

			/* --- replace the shipped Effort switch ------------------------ */

			const matchesEffortRow = (element) => {
				const row = element.closest('button[role="menuitem"]');
				if (!row) return null;
				const text = (row.textContent || '').trim();
				if (!EFFORT_ROW_PREFIXES.some((prefix) => text.startsWith(prefix))) return null;
				return row;
			};

			const onDocumentClick = (event) => {
				const target = event.target;
				// Duck-typed: slots may live in another document (portal) where a
				// cross-realm `instanceof Element` would be false.
				if (!target || typeof target.closest !== 'function') return;
				if (target.closest('[data-ccs-root]')) return;
				const row = matchesEffortRow(target);
				if (row !== null) {
					// Without a live session there is nothing to write: leave the
					// shipped row alone instead of swallowing the click.
					if (activeSessionId === null) return;
					// ⌥/⌘/Ctrl-click keeps the shipped level pane reachable.
					if (event.altKey || event.metaKey || event.ctrlKey) return;
					event.preventDefault();
					event.stopPropagation();
					controller.toggle(row, row.getBoundingClientRect());
					// The shipped menu closes on a document-level mousedown; dismissing
					// it leaves the popover as the only surface on screen.
					document.body.dispatchEvent(
						new MouseEvent('mousedown', { bubbles: true, cancelable: true })
					);
					return;
				}
				controller.close();
			};

			const onDocumentKeyDown = (event) => {
				if (event.key !== 'Escape') return;
				if (!controller.getSnapshot().open) return;
				controller.close();
			};

			document.addEventListener('click', onDocumentClick, true);
			document.addEventListener('keydown', onDocumentKeyDown, true);

			ctx.effect(
				() => () => {
					document.removeEventListener('click', onDocumentClick, true);
					document.removeEventListener('keydown', onDocumentKeyDown, true);
					controller.close();
				},
				'cc-effort-slider: effort interception'
			);
		}

		return { inject, apply };
	},
});
