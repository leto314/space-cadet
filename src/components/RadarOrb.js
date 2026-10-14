import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { GLView } from "expo-gl";

// The living body of the statistics radar: the React Bits "Orb" shader (MIT + Commons Clause), reshaped. Instead
// of a ring, the glowing rim follows the radar polygon (six radii, one per competence); instead of a fixed
// palette, the colour turns with the angle through the six competence colours. What is kept from the orb: the
// noise that makes the rim breathe, the soft light falling off on both sides of it, and the bright spot that
// travels along it.
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
uniform float unit;
uniform float values[6];
uniform vec3 colors[6];
varying vec2 vUv;

const float PI = 3.14159265;
const float SECTOR = 1.04719755;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}

float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}

float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

// For an angle measured clockwise from the top: how far the polygon's edge is, and the colour at that angle.
void edgeAt(float theta, out float radius, out vec3 color) {
  float t = theta / SECTOR;
  float k = floor(t);
  float f = t - k;
  float next = mod(k + 1.0, 6.0);
  float a = values[0];
  float b = values[0];
  vec3 ca = colors[0];
  vec3 cb = colors[0];
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi == k) { a = values[i]; ca = colors[i]; }
    if (fi == next) { b = values[i]; cb = colors[i]; }
  }
  a = max(a, 0.04);
  b = max(b, 0.04);
  float phi = f * SECTOR;
  radius = a * b * 0.8660254 / (a * sin(phi) + b * sin(SECTOR - phi));
  color = mix(ca, cb, smoothstep(0.0, 1.0, f));
}

void main() {
  vec2 uv = (vUv * iResolution - 0.5 * iResolution) / unit;
  float len = length(uv);
  float theta = atan(uv.x, uv.y);
  if (theta < 0.0) theta += 2.0 * PI;

  float edge;
  vec3 rainbow;
  edgeAt(theta, edge, rainbow);

  // The rim breathes: slow noise pushes it in and out by a few percent.
  float n0 = snoise3(vec3(uv * 1.3, iTime * 0.3)) * 0.5 + 0.5;
  float r0 = edge * mix(0.955, 1.025, n0);
  float d0 = abs(len - r0);

  float glow = light1(1.0, 15.0, d0);
  float inside = step(len, r0);
  float depth = smoothstep(r0 * 0.3, r0 * 0.98, len);
  float body = glow * mix(0.5, 1.0, depth) * 0.8 + 0.2;
  float halo = glow * exp(-(len - r0) * 5.5);
  float intensity = mix(halo, body, inside);

  // A slow wave of brightness turning around the shape, and a bright spot travelling along the rim.
  float wave = cos(theta - iTime * 0.7) * 0.5 + 0.5;
  float spotAngle = mod(iTime * 0.42, 2.0 * PI);
  float spotRadius;
  vec3 spotColor;
  edgeAt(spotAngle, spotRadius, spotColor);
  float spot = light2(1.25, 10.0, distance(uv, vec2(sin(spotAngle), cos(spotAngle)) * spotRadius)) * light1(1.0, 45.0, d0);

  float core = smoothstep(0.03, 0.0, d0);
  // The rim keeps the pure competence colours; only the travelling spot is allowed to burn toward white.
  vec3 color = rainbow * intensity * mix(0.8, 1.0, wave);
  color += rainbow * core * 0.2;
  color += mix(spotColor, vec3(1.0), 0.55) * spot * 0.9;

  // Each competence is a small point of light where the rim turns: a tight, almost white core fading into its
  // own colour, part of the glow rather than a flat dot on top of it.
  for (int i = 0; i < 6; i++) {
    float angle = float(i) * SECTOR;
    vec2 node = vec2(sin(angle), cos(angle)) * max(values[i], 0.04);
    float dist = distance(uv, node);
    color += colors[i] * light2(0.9, 1500.0, dist);
    color += mix(colors[i], vec3(1.0), 0.6) * smoothstep(0.028, 0.0, dist) * 0.6;
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Radar shader compilation failed.");
  return shader;
}
function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Radar shader link failed.");
  return program;
}
const hexToRgb = (color) => [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];

// `values` are the six radii (0 to 1, first one at the top, then clockwise); `radiusShare` is the radar's full
// radius as a share of the view's width. The loop only runs while `active`; the last frame stays on screen.
export function RadarOrb({ values, colors, radiusShare, active = true }) {
  const valuesRef = useRef(values);
  const activeRef = useRef(active);
  const frameRef = useRef(null);
  const renderRef = useRef(null);
  const mountedRef = useRef(true);
  valuesRef.current = values;

  useEffect(() => () => { mountedRef.current = false; if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);
  useEffect(() => {
    activeRef.current = active;
    if (active && renderRef.current && !frameRef.current) frameRef.current = requestAnimationFrame(renderRef.current);
  }, [active]);

  function onContextCreate(gl) {
    const program = createProgram(gl);
    const position = gl.getAttribLocation(program, "position");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const uniforms = {
      time: gl.getUniformLocation(program, "iTime"),
      resolution: gl.getUniformLocation(program, "iResolution"),
      unit: gl.getUniformLocation(program, "unit"),
      values: gl.getUniformLocation(program, "values"),
      colors: gl.getUniformLocation(program, "colors"),
    };
    const palette = new Float32Array(colors.flatMap(hexToRgb));

    function render(timestamp) {
      frameRef.current = null;
      if (!mountedRef.current) return;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, timestamp * 0.001);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform1f(uniforms.unit, width * radiusShare);
      gl.uniform1fv(uniforms.values, new Float32Array(valuesRef.current));
      gl.uniform3fv(uniforms.colors, palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endFrameEXP?.();
      if (activeRef.current) frameRef.current = requestAnimationFrame(render);
    }
    renderRef.current = render;
    render(0);
  }

  return <GLView pointerEvents="none" style={styles.gl} msaaSamples={0} onContextCreate={onContextCreate} />;
}

const styles = StyleSheet.create({
  gl: { ...StyleSheet.absoluteFill, backgroundColor: "#000000" },
});
