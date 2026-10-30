import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { GLView } from "expo-gl";

// The living body of the statistics radar, drawn by a shader in the same spirit as the progress curve (GlowChart):
// the outline of the six-sided shape is a bright line with a soft glow on both sides, its colour turns with the
// angle through the six competence colours, the inside is a faint tint of the same colours, each corner carries a
// glowing node, a light travels around the outline, and the outline breathes slightly.
const AXES = 6;

const VERTEX_SHADER = `
precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float scale;
uniform float radius;
uniform float values[${AXES}];
uniform vec3 colors[${AXES}];
uniform vec3 background;
varying vec2 vUv;

const float TAU = 6.28318531;

float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

// Corner i of the shape, in pixels (y down): the first axis points up, the others follow clockwise.
vec2 corner(int i, vec2 center) {
  float angle = float(i) * TAU / ${AXES}.0;
  float value = 0.0;
  for (int j = 0; j < ${AXES}; j++) if (j == i) value = values[j];
  return center + vec2(sin(angle), -cos(angle)) * radius * max(value, 0.02);
}

vec3 colorAt(int i) {
  vec3 result = colors[0];
  for (int j = 0; j < ${AXES}; j++) if (j == i) result = colors[j];
  return result;
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * iResolution;
  vec2 center = iResolution * 0.5;
  vec2 offset = p - center;

  // Angle clockwise from the top, 0 to 1 around the circle, and the sector (between two axes) it falls in.
  float turn = fract(atan(offset.x, -offset.y) / TAU + 1.0);
  float sectorF = turn * ${AXES}.0;
  int sector = int(floor(sectorF));
  float along = fract(sectorF);

  // Colour: the two neighbouring competence colours, blended smoothly across the sector.
  int nextSector = sector + 1 == ${AXES} ? 0 : sector + 1;
  vec3 color = mix(colorAt(sector), colorAt(nextSector), smoothstep(0.0, 1.0, along));

  // Distance to the outline, and whether the pixel is inside (the shape is seen whole from its centre, so the
  // pixel is inside when it lies on the centre's side of its own sector's edge).
  float minD = 1e5;
  for (int i = 0; i < ${AXES}; i++) {
    int j = i + 1 == ${AXES} ? 0 : i + 1;
    minD = min(minD, segmentDistance(p, corner(i, center), corner(j, center)));
  }
  vec2 a = corner(sector, center);
  vec2 b = corner(nextSector, center);
  vec2 edge = b - a;
  float side = (edge.x * (p.y - a.y) - edge.y * (p.x - a.x)) * (edge.x * (center.y - a.y) - edge.y * (center.x - a.x));
  float inside = side > 0.0 ? 1.0 : 0.0;

  // The outline breathes: a slow ripple along it, a pixel or two either way.
  float angle = turn * TAU;
  float ripple = sin(angle * 3.0 + iTime * 1.1) * 0.55 + sin(angle * 5.0 - iTime * 0.8) * 0.3 + sin(angle * 2.0 + iTime * 0.5) * 0.15;
  float signedD = (inside > 0.5 ? -minD : minD) / scale + ripple * 1.4;
  float d = abs(signedD);

  vec3 col = vec3(0.0);

  // Inside: a faint, even tint of the same colours, a touch stronger right along the outline.
  float depth = clamp(-signedD / (radius / scale * 0.35), 0.0, 1.0);
  col += color * inside * mix(0.3, 0.2, depth);

  // Outside: a broad, very faint halo.
  col += color * (1.0 - inside) * 0.07 * exp(-d / 38.0);

  // The outline: a thin bright core, whiter where it shines most, and its glow on both sides. Its brightness
  // drifts slowly along the outline, so some stretches flare while others rest.
  float shimmer = 0.8 + 0.3 * sin(angle * 2.0 - iTime * 0.7) * sin(angle * 3.0 + iTime * 0.45 + 1.0);
  // The core has no hard edge: a soft bell, as if slightly out of focus.
  float core = exp(-d * d / 1.6) * 0.85;
  float glow = light2(1.0, 0.028, d);
  col += color * glow * 0.85 * shimmer;
  col += mix(color, vec3(1.0), 0.3 * shimmer) * core * shimmer;

  // A light travelling around the outline, held to the outline itself.
  float travel = fract(iTime * 0.07) * ${AXES}.0;
  int travelSector = int(floor(travel));
  vec2 spotPoint = center;
  for (int i = 0; i < ${AXES}; i++) {
    int j = i + 1 == ${AXES} ? 0 : i + 1;
    if (i == travelSector) spotPoint = mix(corner(i, center), corner(j, center), fract(travel));
  }
  float spot = light2(1.0, 0.01, distance(p, spotPoint) / scale) * light2(1.0, 0.07, d);
  col += mix(color, vec3(1.0), 0.5) * spot * 0.9;

  // A glowing node on each corner, pulsing gently out of step with the others.
  for (int i = 0; i < ${AXES}; i++) {
    float dn = distance(p, corner(i, center)) / scale;
    float pulse = 0.75 + 0.25 * sin(iTime * 2.0 + float(i) * 1.3);
    vec3 nodeColor = colorAt(i);
    col += mix(nodeColor, vec3(1.0), 0.8) * exp(-dn * dn / 3.0);
    col += nodeColor * light2(1.0, 0.035, dn) * pulse * 0.8;
  }

  gl_FragColor = vec4(clamp(background + col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Radar shader compilation failed.");
  return shader;
}
const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

// `values`: the six radii (0 to 1, the first at the top, then clockwise); `colors`: the six matching colours;
// `radiusShare`: the radar's full radius as a share of the view's width. The loop only runs while `active`.
export function RadarGlow({ values, colors, radiusShare, background = "#000000", active = true }) {
  const valuesRef = useRef(values);
  const colorsRef = useRef(colors);
  const widthRef = useRef(1);
  const frameRef = useRef(null);
  const aliveRef = useRef(true);
  const activeRef = useRef(active);
  const renderRef = useRef(null);
  valuesRef.current = values;
  colorsRef.current = colors;

  useEffect(() => () => { aliveRef.current = false; if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);
  useEffect(() => {
    activeRef.current = active;
    if (active && renderRef.current && !frameRef.current) frameRef.current = requestAnimationFrame(renderRef.current);
  }, [active]);

  function onContextCreate(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Radar shader link failed.");
    const position = gl.getAttribLocation(program, "position");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const uniform = (name) => gl.getUniformLocation(program, name);
    const uniforms = { time: uniform("iTime"), resolution: uniform("iResolution"), scale: uniform("scale"), radius: uniform("radius"), values: uniform("values"), colors: uniform("colors"), background: uniform("background") };
    const [br, bg, bb] = hexToRgb(background);

    function render(timestamp) {
      frameRef.current = null;
      if (!aliveRef.current) return;
      const width = gl.drawingBufferWidth;
      const heightPx = gl.drawingBufferHeight;
      gl.viewport(0, 0, width, heightPx);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, timestamp * 0.001);
      gl.uniform2f(uniforms.resolution, width, heightPx);
      gl.uniform1f(uniforms.scale, width / widthRef.current);
      gl.uniform1f(uniforms.radius, radiusShare * width);
      gl.uniform1fv(uniforms.values, new Float32Array(valuesRef.current.map((value) => Math.max(0, Math.min(1, value)))));
      gl.uniform3fv(uniforms.colors, new Float32Array(colorsRef.current.flatMap(hexToRgb)));
      gl.uniform3f(uniforms.background, br, bg, bb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endFrameEXP?.();
      if (activeRef.current) frameRef.current = requestAnimationFrame(render);
    }
    renderRef.current = render;
    render(0);
  }

  return <GLView pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: background }]} msaaSamples={0} onLayout={(event) => { widthRef.current = event.nativeEvent.layout.width || 1; }} onContextCreate={onContextCreate} />;
}
