import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_DIRECTIONS,
  OBJECT_DIRECTION_CODES,
  DEFAULT_OBJECT_DIRECTION,
  DEFAULT_OBJECT_POSITION_MODE,
  OBJECT_POSITION_MODES,
  normalizeObjectDirection,
  objectDirectionMeta,
  normalizeObjectPositionMode,
  objectVisualRadius,
  resolveObjectSceneDistance,
  buildObjectScene,
  renderObjectSvg,
} from '../dist/object-direction.mjs';

// ---------- SIX DIRECTION DEFINITIONS ----------

test('defines exactly six directions: UP, DOWN, LEFT, RIGHT, FRONT, BACK', () => {
  assert.equal(OBJECT_DIRECTIONS.length, 6);
  assert.deepEqual(OBJECT_DIRECTION_CODES, ['UP', 'DOWN', 'LEFT', 'RIGHT', 'FRONT', 'BACK']);
});

test('each direction has code, label, axis, axisCode, angleDeg, arrow, waveDirection, and hint', () => {
  for (const dir of OBJECT_DIRECTIONS) {
    assert.ok(typeof dir.code === 'string' && dir.code.length > 0);
    assert.ok(typeof dir.label === 'string' && dir.label.length > 0);
    assert.ok(['X', 'Y', 'Z'].includes(dir.axis));
    assert.ok(typeof dir.axisCode === 'string');
    assert.ok(typeof dir.angleDeg === 'number');
    assert.ok(typeof dir.arrow === 'string' && dir.arrow.length > 0);
    assert.ok(typeof dir.waveDirection === 'string');
    assert.ok(typeof dir.hint === 'string');
  }
});

test('default direction is DOWN', () => {
  assert.equal(DEFAULT_OBJECT_DIRECTION, 'DOWN');
});

test('UP maps to Y+ axis at 270 degrees', () => {
  const up = OBJECT_DIRECTIONS.find(d => d.code === 'UP');
  assert.equal(up.axis, 'Y');
  assert.equal(up.axisCode, 'Y+');
  assert.equal(up.angleDeg, 270);
});

test('DOWN maps to Y- axis at 90 degrees', () => {
  const down = OBJECT_DIRECTIONS.find(d => d.code === 'DOWN');
  assert.equal(down.axis, 'Y');
  assert.equal(down.axisCode, 'Y−');
  assert.equal(down.angleDeg, 90);
});

test('LEFT maps to X- axis', () => {
  const left = OBJECT_DIRECTIONS.find(d => d.code === 'LEFT');
  assert.equal(left.axis, 'X');
  assert.equal(left.axisCode, 'X−');
});

test('RIGHT maps to X+ axis', () => {
  const right = OBJECT_DIRECTIONS.find(d => d.code === 'RIGHT');
  assert.equal(right.axis, 'X');
  assert.equal(right.axisCode, 'X+');
});

test('FRONT maps to Z+ axis', () => {
  const front = OBJECT_DIRECTIONS.find(d => d.code === 'FRONT');
  assert.equal(front.axis, 'Z');
  assert.equal(front.axisCode, 'Z+');
});

test('BACK maps to Z- axis', () => {
  const back = OBJECT_DIRECTIONS.find(d => d.code === 'BACK');
  assert.equal(back.axis, 'Z');
  assert.equal(back.axisCode, 'Z−');
});

// ---------- DIRECTION NORMALIZATION ----------

test('normalizeObjectDirection returns valid direction code', () => {
  assert.equal(normalizeObjectDirection('UP'), 'UP');
  assert.equal(normalizeObjectDirection('down'), 'DOWN');
  assert.equal(normalizeObjectDirection('  left  '), 'LEFT');
  assert.equal(normalizeObjectDirection('Right'), 'RIGHT');
  assert.equal(normalizeObjectDirection('front'), 'FRONT');
  assert.equal(normalizeObjectDirection('BACK'), 'BACK');
});

test('normalizeObjectDirection returns DEFAULT for invalid input', () => {
  assert.equal(normalizeObjectDirection(''), DEFAULT_OBJECT_DIRECTION);
  assert.equal(normalizeObjectDirection(null), DEFAULT_OBJECT_DIRECTION);
  assert.equal(normalizeObjectDirection(undefined), DEFAULT_OBJECT_DIRECTION);
  assert.equal(normalizeObjectDirection('DIAGONAL'), DEFAULT_OBJECT_DIRECTION);
  assert.equal(normalizeObjectDirection(42), DEFAULT_OBJECT_DIRECTION);
});

test('objectDirectionMeta returns metadata for valid directions', () => {
  const meta = objectDirectionMeta('UP');
  assert.equal(meta.code, 'UP');
  assert.equal(meta.label, 'Atas');
  assert.ok(meta.hint.length > 0);
});

test('objectDirectionMeta falls back for invalid direction', () => {
  const meta = objectDirectionMeta('INVALID');
  assert.equal(meta.code, DEFAULT_OBJECT_DIRECTION);
});

// ---------- POSITION MODE ----------

test('position modes are live and target', () => {
  assert.deepEqual(OBJECT_POSITION_MODES, ['live', 'target']);
  assert.equal(DEFAULT_OBJECT_POSITION_MODE, 'live');
});

test('normalizeObjectPositionMode handles valid and invalid input', () => {
  assert.equal(normalizeObjectPositionMode('live'), 'live');
  assert.equal(normalizeObjectPositionMode('TARGET'), 'target');
  assert.equal(normalizeObjectPositionMode(''), DEFAULT_OBJECT_POSITION_MODE);
  assert.equal(normalizeObjectPositionMode(null), DEFAULT_OBJECT_POSITION_MODE);
});

// ---------- VISUAL RADIUS ----------

test('objectVisualRadius returns minimum for null or zero distance', () => {
  const minR = objectVisualRadius(null);
  const zeroR = objectVisualRadius(0);
  assert.ok(minR > 0);
  assert.equal(zeroR, minR);
});

test('objectVisualRadius increases with distance', () => {
  const r20 = objectVisualRadius(20);
  const r40 = objectVisualRadius(40);
  const r60 = objectVisualRadius(60);
  assert.ok(r20 < r40);
  assert.ok(r40 < r60);
});

test('objectVisualRadius clamps at visual limit', () => {
  const r80 = objectVisualRadius(80);
  const r200 = objectVisualRadius(200);
  assert.equal(r80, r200);
});

// ---------- RESOLVE SCENE DISTANCE ----------

test('resolveObjectSceneDistance uses live data in live mode', () => {
  const result = resolveObjectSceneDistance({ liveDistanceCm: 35, positionMode: 'live' });
  assert.equal(result.distanceCm, 35);
  assert.equal(result.source, 'live');
  assert.equal(result.hasLiveEcho, true);
});

test('resolveObjectSceneDistance falls back to target when live is null', () => {
  const result = resolveObjectSceneDistance({ liveDistanceCm: null, targetDistanceCm: 50, positionMode: 'live' });
  assert.equal(result.distanceCm, 50);
  assert.equal(result.source, 'target');
  assert.equal(result.hasLiveEcho, false);
});

test('resolveObjectSceneDistance uses target in target mode even with live data', () => {
  const result = resolveObjectSceneDistance({ liveDistanceCm: 35, targetDistanceCm: 50, positionMode: 'target' });
  assert.equal(result.distanceCm, 50);
  assert.equal(result.source, 'target');
  assert.equal(result.hasLiveEcho, true);
});

test('resolveObjectSceneDistance defaults to midpoint when no target is given', () => {
  const result = resolveObjectSceneDistance({ minCm: 20, maxCm: 60, positionMode: 'target' });
  assert.equal(result.distanceCm, 40);
  assert.equal(result.source, 'target');
});

// ---------- BUILD OBJECT SCENE (DIRECTION-DEPENDENT) ----------

test('buildObjectScene returns scene for each of the six directions', () => {
  for (const code of OBJECT_DIRECTION_CODES) {
    const scene = buildObjectScene({ direction: code, liveDistanceCm: 40 });
    assert.equal(scene.direction, code);
    assert.ok(scene.directionLabel.length > 0);
    assert.ok(scene.directionHint.length > 0);
    assert.ok(typeof scene.angleDeg === 'number');
    assert.ok(typeof scene.sensorTransform === 'string');
    assert.ok(typeof scene.beamPath === 'string');
    assert.ok(scene.axes.length === 6);
    assert.ok(scene.target.x !== undefined);
    assert.ok(scene.target.y !== undefined);
    assert.ok(typeof scene.distanceLine === 'object');
    assert.ok(typeof scene.echoWaves === 'object');
    assert.ok(typeof scene.rangeTicks === 'object');
  }
});

test('buildObjectScene changes sensor transform and target position per direction', () => {
  const sceneDown = buildObjectScene({ direction: 'DOWN', liveDistanceCm: 40 });
  const sceneUp = buildObjectScene({ direction: 'UP', liveDistanceCm: 40 });
  const sceneRight = buildObjectScene({ direction: 'RIGHT', liveDistanceCm: 40 });
  // Different directions should produce different sensor transforms and target positions
  assert.notEqual(sceneDown.sensorTransform, sceneUp.sensorTransform);
  assert.notEqual(sceneDown.target.y, sceneUp.target.y);
  assert.notEqual(sceneDown.angleDeg, sceneRight.angleDeg);
});

test('buildObjectScene beam path changes with direction', () => {
  const pathDown = buildObjectScene({ direction: 'DOWN' }).beamPath;
  const pathLeft = buildObjectScene({ direction: 'LEFT' }).beamPath;
  assert.notEqual(pathDown, pathLeft);
});

test('buildObjectScene target moves with live distance', () => {
  const near = buildObjectScene({ direction: 'DOWN', liveDistanceCm: 20 });
  const far = buildObjectScene({ direction: 'DOWN', liveDistanceCm: 60 });
  assert.ok(near.target.radius < far.target.radius);
});

test('buildObjectScene range ticks reflect min and max settings', () => {
  const scene = buildObjectScene({ direction: 'UP', minCm: 15, maxCm: 55 });
  assert.match(scene.rangeTicks.min.label.text, /15/);
  assert.match(scene.rangeTicks.max.label.text, /55/);
});

test('buildObjectScene active axis is highlighted in axes array', () => {
  const scene = buildObjectScene({ direction: 'FRONT' });
  const frontAxis = scene.axes.find(a => a.code === 'FRONT');
  assert.ok(frontAxis);
  assert.equal(frontAxis.code, 'FRONT');
});

// ---------- PRESET DISTANCES ----------

test('buildObjectScene supports preset distances 30, 40, 50, 60', () => {
  for (const cm of [30, 40, 50, 60]) {
    const scene = buildObjectScene({ direction: 'DOWN', targetDistanceCm: cm, positionMode: 'target' });
    assert.equal(scene.target.distanceCm, cm);
  }
});

// ---------- RENDER SVG ----------

test('renderObjectSvg produces valid SVG string for each direction', () => {
  for (const code of OBJECT_DIRECTION_CODES) {
    const svg = renderObjectSvg({ direction: code, state: 'idle' });
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('</svg>'));
    assert.ok(svg.includes('HC-SR04'));
    assert.ok(svg.includes('OBJEK TARGET'));
    assert.ok(svg.includes(`data-state="idle"`));
  }
});

test('renderObjectSvg contains universal cube faces, not hand anatomy', () => {
  const svg = renderObjectSvg({ direction: 'DOWN', state: 'stable' });
  assert.ok(svg.includes('cube-top'));
  assert.ok(svg.includes('cube-left'));
  assert.ok(svg.includes('cube-right'));
  assert.ok(svg.includes('target-crosshair'));
  assert.ok(svg.includes('target-bracket'));
  assert.ok(!svg.includes('hand'));
  assert.ok(!svg.includes('tangan'));
  assert.ok(!svg.includes('telapak'));
});

test('renderObjectSvg shows correct state label in target', () => {
  assert.ok(renderObjectSvg({ state: 'offline' }).includes('OFFLINE'));
  assert.ok(renderObjectSvg({ state: 'invalid' }).includes('TIDAK ADA ECHO'));
  assert.ok(renderObjectSvg({ state: 'stable' }).includes('STABIL'));
  assert.ok(renderObjectSvg({ state: 'unstable' }).includes('TIDAK STABIL'));
  assert.ok(renderObjectSvg({ state: 'collecting' }).includes('MENGUMPULKAN'));
  assert.ok(renderObjectSvg({ state: 'too-close' }).includes('TERLALU DEKAT'));
  assert.ok(renderObjectSvg({ state: 'too-far' }).includes('TERLALU JAUH'));
});

test('renderObjectSvg includes sensor transducers T and R labels', () => {
  const svg = renderObjectSvg({ direction: 'UP', state: 'idle' });
  assert.ok(svg.includes('>T<'));
  assert.ok(svg.includes('>R<'));
});

test('renderObjectSvg has echo waves active only when live echo exists', () => {
  const svgOffline = renderObjectSvg({ direction: 'DOWN', state: 'offline' });
  const svgStable = renderObjectSvg({ direction: 'DOWN', liveDistanceCm: 40, state: 'stable' });
  // Offline: echo-waves group should NOT have is-active class
  assert.ok(!svgOffline.includes('object-echo-waves is-active'), 'offline SVG should not have active echo waves');
  // Stable with live data: echo-waves group SHOULD have is-active class
  assert.ok(svgStable.includes('object-echo-waves is-active'), 'stable SVG with live echo should have active echo waves');
});

test('renderObjectSvg changes angle descriptor per direction', () => {
  const svgUp = renderObjectSvg({ direction: 'UP' });
  const svgDown = renderObjectSvg({ direction: 'DOWN' });
  assert.ok(svgUp.includes('Atas'));
  assert.ok(svgDown.includes('Bawah'));
});

// ---------- DIRECTION AXES IN SVG ----------

test('renderObjectSvg contains all six direction axes with labels', () => {
  const svg = renderObjectSvg({ direction: 'DOWN' });
  for (const dir of OBJECT_DIRECTIONS) {
    assert.ok(svg.includes(`data-direction="${dir.code}"`), `Missing axis for ${dir.code}`);
    assert.ok(svg.includes(dir.axisCode), `Missing axis label ${dir.axisCode}`);
  }
});

test('renderObjectSvg marks the active direction axis as is-active', () => {
  for (const code of OBJECT_DIRECTION_CODES) {
    const svg = renderObjectSvg({ direction: code });
    const activePattern = `data-direction="${code}"`;
    const idx = svg.indexOf(activePattern);
    assert.ok(idx > 0, `Active direction ${code} should appear`);
    // The <g> tag wrapping it should contain is-active
    const gStart = svg.lastIndexOf('<g', idx);
    const snippet = svg.slice(gStart, idx + activePattern.length + 50);
    assert.ok(snippet.includes('is-active'), `Direction ${code} should be marked active`);
  }
});

// ---------- HARDWARE LIMITATION HONESTY ----------

test('each direction hint mentions manual orientation', () => {
  for (const dir of OBJECT_DIRECTIONS) {
    assert.ok(
      dir.hint.toLowerCase().includes('manual') || dir.hint.toLowerCase().includes('standar'),
      `Direction ${dir.code} hint should mention manual orientation or standard position`
    );
  }
});

test('HC-SR04 does not claim 3D coordinate detection', () => {
  for (const code of OBJECT_DIRECTION_CODES) {
    const svg = renderObjectSvg({ direction: code });
    assert.ok(svg.includes('1D'), 'SVG description should mention 1D measurement');
  }
});

// ---------- SWITCHING BETWEEN HEIGHT AND OBJECT MODE ----------

test('buildObjectScene works independent of height measurement mode', () => {
  // Height measurement uses DOWN; object detection should work on any direction
  const heightScene = buildObjectScene({ direction: 'DOWN', liveDistanceCm: 45 });
  const objectScene = buildObjectScene({ direction: 'LEFT', liveDistanceCm: 45 });
  assert.equal(heightScene.direction, 'DOWN');
  assert.equal(objectScene.direction, 'LEFT');
  // Both should have valid target positions
  assert.ok(Number.isFinite(heightScene.target.x));
  assert.ok(Number.isFinite(objectScene.target.x));
});

// ---------- DISCONNECTED STATE ----------

test('renderObjectSvg handles offline state gracefully', () => {
  const svg = renderObjectSvg({ direction: 'UP', liveDistanceCm: null, state: 'offline' });
  assert.ok(svg.includes('data-state="offline"'));
  assert.ok(svg.includes('OFFLINE'));
});
