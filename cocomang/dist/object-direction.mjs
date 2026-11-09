export const OBJECT_DIRECTIONS = Object.freeze([
  Object.freeze({
    code: 'UP',
    label: 'Atas',
    axis: 'Y',
    sign: '+',
    axisCode: 'Y+',
    angleDeg: 270,
    arrow: '↑',
    waveDirection: 'Memancar vertikal ke atas (sumbu Y+)',
    hint: 'Sensor memancar ke atas. Sesuaikan orientasi fisik sensor secara manual.',
  }),
  Object.freeze({
    code: 'DOWN',
    label: 'Bawah',
    axis: 'Y',
    sign: '−',
    axisCode: 'Y−',
    angleDeg: 90,
    arrow: '↓',
    waveDirection: 'Memancar vertikal ke bawah (sumbu Y−)',
    hint: 'Sensor memancar ke bawah (posisi standar pengukuran tinggi badan).',
  }),
  Object.freeze({
    code: 'LEFT',
    label: 'Kiri',
    axis: 'X',
    sign: '−',
    axisCode: 'X−',
    angleDeg: 210,
    arrow: '←',
    waveDirection: 'Memancar horizontal ke kiri (sumbu isometrik X−)',
    hint: 'Sensor memancar ke kiri. Sesuaikan orientasi fisik sensor secara manual.',
  }),
  Object.freeze({
    code: 'RIGHT',
    label: 'Kanan',
    axis: 'X',
    sign: '+',
    axisCode: 'X+',
    angleDeg: 30,
    arrow: '→',
    waveDirection: 'Memancar horizontal ke kanan (sumbu isometrik X+)',
    hint: 'Sensor memancar ke kanan. Sesuaikan orientasi fisik sensor secara manual.',
  }),
  Object.freeze({
    code: 'FRONT',
    label: 'Depan',
    axis: 'Z',
    sign: '+',
    axisCode: 'Z+',
    angleDeg: 150,
    arrow: '↙',
    waveDirection: 'Memancar ke depan (sumbu isometrik Z+)',
    hint: 'Sensor memancar ke depan. Sesuaikan orientasi fisik sensor secara manual.',
  }),
  Object.freeze({
    code: 'BACK',
    label: 'Belakang',
    axis: 'Z',
    sign: '−',
    axisCode: 'Z−',
    angleDeg: 330,
    arrow: '↗',
    waveDirection: 'Memancar ke belakang (sumbu isometrik Z−)',
    hint: 'Sensor memancar ke belakang. Sesuaikan orientasi fisik sensor secara manual.',
  }),
]);

export const OBJECT_DIRECTION_CODES = Object.freeze(OBJECT_DIRECTIONS.map(item => item.code));
export const DEFAULT_OBJECT_DIRECTION = 'DOWN';
export const OBJECT_POSITION_MODES = Object.freeze(['live', 'target']);
export const DEFAULT_OBJECT_POSITION_MODE = 'live';

const SCENE_WIDTH = 760;
const SCENE_HEIGHT = 480;
const SOURCE = Object.freeze({ x: 380, y: 240 });
const AXIS_RADIUS = 188;
const AXIS_LABEL_RADIUS = 216;
const SENSOR_OFFSET = 24;
const MIN_VISUAL_RADIUS = 70;
const MAX_VISUAL_RADIUS = 180;
const VISUAL_LIMIT_CM = 80;

const DIRECTIONS_BY_CODE = new Map(OBJECT_DIRECTIONS.map(item => [item.code, item]));
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeDirection = value => String(value ?? '').trim().toUpperCase();

export function normalizeObjectDirection(value) {
  const code = normalizeDirection(value);
  return DIRECTIONS_BY_CODE.has(code) ? code : DEFAULT_OBJECT_DIRECTION;
}

export function objectDirectionMeta(value) {
  return DIRECTIONS_BY_CODE.get(normalizeObjectDirection(value));
}

export function normalizeObjectPositionMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return OBJECT_POSITION_MODES.includes(mode) ? mode : DEFAULT_OBJECT_POSITION_MODE;
}

export function objectVisualRadius(distanceCm) {
  if (!finite(distanceCm)) return MIN_VISUAL_RADIUS;
  const clamped = clamp(Number(distanceCm), 0, VISUAL_LIMIT_CM);
  return round(MIN_VISUAL_RADIUS + (clamped / VISUAL_LIMIT_CM) * (MAX_VISUAL_RADIUS - MIN_VISUAL_RADIUS));
}

export function resolveObjectSceneDistance({
  liveDistanceCm = null,
  targetDistanceCm = null,
  minCm = 20,
  maxCm = 60,
  positionMode = DEFAULT_OBJECT_POSITION_MODE,
} = {}) {
  const mode = normalizeObjectPositionMode(positionMode);
  const min = finite(minCm) && Number(minCm) >= 2 ? Number(minCm) : 20;
  const max = finite(maxCm) && Number(maxCm) > min ? Number(maxCm) : Math.max(60, min + 1);
  const fallback = finite(targetDistanceCm) && Number(targetDistanceCm) > 0
    ? Number(targetDistanceCm)
    : round((min + max) / 2);
  const live = finite(liveDistanceCm) ? Number(liveDistanceCm) : null;
  if (mode === 'target' || live == null) {
    return { distanceCm: round(fallback), source: 'target', hasLiveEcho: live != null };
  }
  return { distanceCm: round(live), source: 'live', hasLiveEcho: true };
}

const pointAt = (angleDeg, radius) => {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: round(SOURCE.x + Math.cos(radians) * radius),
    y: round(SOURCE.y + Math.sin(radians) * radius),
    ux: Math.cos(radians),
    uy: Math.sin(radians),
  };
};

const polygon = points => points
  .map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`)
  .join(' ') + ' Z';

function buildBeam(direction, maxCm) {
  const radius = objectVisualRadius(maxCm);
  const end = pointAt(direction.angleDeg, radius);
  const start = SOURCE;
  const px = -end.uy;
  const py = end.ux;
  const nearWidth = 12;
  const farWidth = 44;
  return polygon([
    { x: start.x + px * nearWidth, y: start.y + py * nearWidth },
    { x: end.x + px * farWidth, y: end.y + py * farWidth },
    { x: end.x - px * farWidth, y: end.y - py * farWidth },
    { x: start.x - px * nearWidth, y: start.y - py * nearWidth },
  ]);
}

function buildEchoWaves(direction, radius) {
  return [0.32, 0.54, 0.76].map(fraction => {
    const waveDist = Math.max(28, radius * fraction);
    const point = pointAt(direction.angleDeg, waveDist);
    const px = -point.uy;
    const py = point.ux;
    const halfWidth = 10 + waveDist * 0.22;
    const left = { x: point.x + px * halfWidth, y: point.y + py * halfWidth };
    const right = { x: point.x - px * halfWidth, y: point.y - py * halfWidth };
    const control = {
      x: point.x + point.ux * halfWidth * 0.45,
      y: point.y + point.uy * halfWidth * 0.45,
    };
    return `M ${round(left.x)} ${round(left.y)} Q ${round(control.x)} ${round(control.y)} ${round(right.x)} ${round(right.y)}`;
  });
}

function buildRangeTick(direction, distanceCm) {
  const point = pointAt(direction.angleDeg, objectVisualRadius(distanceCm));
  const px = -point.uy;
  const py = point.ux;
  const half = 18;
  return {
    path: `M ${round(point.x + px * half)} ${round(point.y + py * half)} L ${round(point.x - px * half)} ${round(point.y - py * half)}`,
    label: {
      x: round(point.x + px * 28 + point.ux * 2),
      y: round(point.y + py * 28 + point.uy * 2 + 3),
      text: `${round(Number(distanceCm))} cm`,
    },
  };
}

function buildAxis(direction) {
  const endpoint = pointAt(direction.angleDeg, AXIS_RADIUS);
  const tip = pointAt(direction.angleDeg, AXIS_RADIUS + 9);
  const baseCenter = pointAt(direction.angleDeg, AXIS_RADIUS - 2);
  const labelPoint = pointAt(direction.angleDeg, AXIS_LABEL_RADIUS);
  const px = -endpoint.uy;
  const py = endpoint.ux;
  const baseLeft = { x: baseCenter.x + px * 4.5, y: baseCenter.y + py * 4.5 };
  const baseRight = { x: baseCenter.x - px * 4.5, y: baseCenter.y - py * 4.5 };
  return {
    code: direction.code,
    label: direction.label,
    axisCode: direction.axisCode,
    angleDeg: direction.angleDeg,
    line: { x1: SOURCE.x, y1: SOURCE.y, x2: endpoint.x, y2: endpoint.y },
    arrow: polygon([tip, baseLeft, baseRight]),
    labelPoint: { x: labelPoint.x, y: labelPoint.y },
  };
}

export function buildObjectScene({
  direction = DEFAULT_OBJECT_DIRECTION,
  liveDistanceCm = null,
  targetDistanceCm = null,
  minCm = 20,
  maxCm = 60,
  positionMode = DEFAULT_OBJECT_POSITION_MODE,
} = {}) {
  const normalizedDirection = normalizeObjectDirection(direction);
  const meta = objectDirectionMeta(normalizedDirection);
  const min = finite(minCm) && Number(minCm) >= 2 ? Number(minCm) : 20;
  const max = finite(maxCm) && Number(maxCm) > min ? Number(maxCm) : Math.max(60, min + 1);
  const resolved = resolveObjectSceneDistance({ liveDistanceCm, targetDistanceCm, minCm: min, maxCm: max, positionMode });
  const radius = objectVisualRadius(resolved.distanceCm);
  const target = pointAt(meta.angleDeg, radius);
  const px = -target.uy;
  const py = target.ux;
  const tagRadius = radius * 0.52;
  const tagPoint = pointAt(meta.angleDeg, tagRadius);
  const sensorCenter = {
    x: round(SOURCE.x - target.ux * SENSOR_OFFSET),
    y: round(SOURCE.y - target.uy * SENSOR_OFFSET),
  };
  const waveRadius = radius * 0.86;
  const minTick = buildRangeTick(meta, min);
  const maxTick = buildRangeTick(meta, max);

  return {
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    source: SOURCE,
    direction: normalizedDirection,
    directionLabel: meta.label,
    directionHint: meta.hint,
    axisCode: meta.axisCode,
    angleDeg: meta.angleDeg,
    sensorTransform: `translate(${sensorCenter.x} ${sensorCenter.y}) rotate(${meta.angleDeg})`,
    beamPath: buildBeam(meta, max),
    axes: OBJECT_DIRECTIONS.map(buildAxis),
    target: {
      x: target.x,
      y: target.y,
      transform: `translate(${target.x} ${target.y})`,
      distanceCm: resolved.distanceCm,
      radius,
      source: resolved.source,
      hasLiveEcho: resolved.hasLiveEcho,
    },
    distanceLine: {
      x1: SOURCE.x,
      y1: SOURCE.y,
      x2: target.x,
      y2: target.y,
    },
    distanceTag: {
      x: round(tagPoint.x + px * 22),
      y: round(tagPoint.y + py * 22),
      text: `${round(resolved.distanceCm)} cm`,
    },
    echoWaves: buildEchoWaves(meta, waveRadius),
    rangeTicks: {
      min: minTick,
      max: maxTick,
    },
  };
}

export function renderObjectSvg({
  direction = DEFAULT_OBJECT_DIRECTION,
  liveDistanceCm = null,
  targetDistanceCm = null,
  minCm = 20,
  maxCm = 60,
  positionMode = DEFAULT_OBJECT_POSITION_MODE,
  state = 'offline',
} = {}) {
  const scene = buildObjectScene({ direction, liveDistanceCm, targetDistanceCm, minCm, maxCm, positionMode });
  const hasLiveEcho = scene.target.hasLiveEcho && state !== 'offline' && state !== 'invalid';
  const targetLabel = state === 'offline' ? 'OFFLINE'
    : state === 'invalid' ? 'TIDAK ADA ECHO'
    : state === 'too-close' ? 'TERLALU DEKAT'
    : state === 'too-far' ? 'TERLALU JAUH'
    : state === 'stable' ? 'STABIL'
    : state === 'unstable' ? 'TIDAK STABIL'
    : state === 'collecting' ? 'MENGUMPULKAN'
    : 'SIAP';

  const axesSvg = scene.axes.map(axis => {
    const isActive = axis.code === scene.direction;
    const activeClass = isActive ? 'is-active' : '';
    return `<g class="object-axis ${activeClass}" data-direction="${axis.code}">
      <line class="object-axis-line ${activeClass}" x1="${axis.line.x1}" y1="${axis.line.y1}" x2="${axis.line.x2}" y2="${axis.line.y2}"></line>
      <polygon class="object-axis-arrow ${activeClass}" points="${axis.arrow.replace(/^[ML]\s*/, '').replace(/\s*Z$/, '')}"></polygon>
      <text class="object-axis-label ${activeClass}" x="${axis.labelPoint.x}" y="${axis.labelPoint.y + 3}" text-anchor="middle">${axis.axisCode} (${axis.label})</text>
    </g>`;
  }).join('');

  const echoWavesSvg = scene.echoWaves.map((wavePath, idx) =>
    `<path class="echo-wave echo-wave-${idx + 1}" d="${wavePath}"></path>`
  ).join('');

  return `<svg viewBox="0 0 ${scene.width} ${scene.height}" id="object-svg" role="img" aria-labelledby="object-viz-title object-viz-desc" class="object-3d-svg" data-state="${state}">
    <title id="object-viz-title">Visualisasi Deteksi Objek 3D Isometrik &amp; HC-SR04</title>
    <desc id="object-viz-desc">Sensor HC-SR04 mengukur jarak 1D sepanjang sumbu ${scene.directionLabel} (${scene.axisCode}). Target: kubus geometris universal.</desc>
    <defs>
      <linearGradient id="object-beam-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#eed064" stop-opacity="0.30"></stop>
        <stop offset="60%" stop-color="#eed064" stop-opacity="0.08"></stop>
        <stop offset="100%" stop-color="#eed064" stop-opacity="0.01"></stop>
      </linearGradient>
    </defs>

    <!-- 3D Isometric Axes -->
    <g class="object-axes" aria-hidden="true">
      ${axesSvg}
    </g>

    <!-- Ultrasonic Beam Cone -->
    <g class="object-beam-group" aria-hidden="true">
      <path class="object-beam" d="${scene.beamPath}" fill="url(#object-beam-gradient)"></path>
      <!-- Range Ticks -->
      <g class="object-range-ticks">
        <path class="range-tick-path" d="${scene.rangeTicks.min.path}"></path>
        <text class="range-tick-text" x="${scene.rangeTicks.min.label.x}" y="${scene.rangeTicks.min.label.y}">${scene.rangeTicks.min.label.text}</text>
        <path class="range-tick-path" d="${scene.rangeTicks.max.path}"></path>
        <text class="range-tick-text" x="${scene.rangeTicks.max.label.x}" y="${scene.rangeTicks.max.label.y}">${scene.rangeTicks.max.label.text}</text>
      </g>
    </g>

    <!-- Echo Waves -->
    <g class="object-echo-waves ${hasLiveEcho ? 'is-active' : ''}" aria-hidden="true">
      ${echoWavesSvg}
    </g>

    <!-- Distance Guide Line & Tag -->
    <g class="object-distance-guide" aria-hidden="true">
      <line id="object-distance-line" class="object-distance-line" x1="${scene.source.x}" y1="${scene.source.y}" x2="${scene.target.x}" y2="${scene.target.y}"></line>
      <circle class="object-source-dot" cx="${scene.source.x}" cy="${scene.source.y}" r="2.5"></circle>
      <g class="object-distance-tag" transform="translate(${scene.distanceTag.x} ${scene.distanceTag.y})">
        <rect class="object-distance-tag-bg" x="-32" y="-10" width="64" height="20" rx="2"></rect>
        <text class="object-distance-tag-text" x="0" y="3.5" text-anchor="middle">${scene.distanceTag.text}</text>
      </g>
    </g>

    <!-- HC-SR04 Sensor (Rotated around origin) -->
    <g class="object-sensor" transform="${scene.sensorTransform}" aria-hidden="true">
      <!-- PCB -->
      <rect x="-14" y="-28" width="16" height="56" rx="2" class="sensor-pcb"></rect>
      <!-- Transducer Tx -->
      <circle cx="6" cy="-14" r="11" class="sensor-barrel"></circle>
      <circle cx="6" cy="-14" r="7" class="sensor-mesh"></circle>
      <line x1="-1" y1="-14" x2="13" y2="-14" class="sensor-mesh-cross"></line>
      <line x1="6" y1="-21" x2="6" y2="-7" class="sensor-mesh-cross"></line>
      <text x="6" y="-11" class="sensor-tr-label" text-anchor="middle">T</text>
      <!-- Transducer Rx -->
      <circle cx="6" cy="14" r="11" class="sensor-barrel"></circle>
      <circle cx="6" cy="14" r="7" class="sensor-mesh"></circle>
      <line x1="-1" y1="14" x2="13" y2="14" class="sensor-mesh-cross"></line>
      <line x1="6" y1="7" x2="6" y2="21" class="sensor-mesh-cross"></line>
      <text x="6" y="17" class="sensor-tr-label" text-anchor="middle">R</text>
      <!-- Crystal / IC detail -->
      <rect x="-5" y="-5" width="6" height="10" rx="1" class="sensor-crystal"></rect>
      <rect x="-17" y="-12" width="3" height="24" class="sensor-pins"></rect>
      <text x="-19" y="3" text-anchor="end" class="sensor-name">HC-SR04</text>
    </g>

    <!-- Universal Target Object (3D Isometric Cube + Marker) -->
    <g id="object-target-group" class="object-target ${state}" transform="${scene.target.transform}">
      <!-- Isometric Cube Faces -->
      <polygon class="cube-face cube-top" points="0,-18 16,-9 0,0 -16,-9"></polygon>
      <polygon class="cube-face cube-left" points="-16,-9 0,0 0,18 -16,9"></polygon>
      <polygon class="cube-face cube-right" points="0,0 16,-9 16,9 0,18"></polygon>
      <!-- Target Marker Crosshair & Bullseye -->
      <circle cx="0" cy="0" r="3" class="target-center-dot"></circle>
      <line x1="-10" y1="0" x2="10" y2="0" class="target-crosshair"></line>
      <line x1="0" y1="-10" x2="0" y2="10" class="target-crosshair"></line>
      <!-- Target Calibration Brackets -->
      <path class="target-bracket" d="M -22 -14 L -26 -14 L -26 -10"></path>
      <path class="target-bracket" d="M 22 -14 L 26 -14 L 26 -10"></path>
      <path class="target-bracket" d="M -22 14 L -26 14 L -26 10"></path>
      <path class="target-bracket" d="M 22 14 L 26 14 L 26 10"></path>
      <!-- Target Labels -->
      <text class="target-label-main" x="0" y="32" text-anchor="middle">OBJEK TARGET</text>
      <text class="target-label-sub" x="0" y="44" text-anchor="middle">[${targetLabel}]</text>
    </g>
  </svg>`;
}
