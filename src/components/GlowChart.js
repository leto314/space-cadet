import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { GLView } from "expo-gl";

// The progress curve of a game's setup screen, drawn by a shader in the same spirit as the statistics radar
// (RadarOrb): a bright line with a soft glow, a fading area under it, a light that travels along the curve, and
// the latest result pulsing at the end.
const MAX_POINTS = 16;

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
uniform float count;
uniform float values[${MAX_POINTS}];
uniform vec3 color;
uniform vec3 background;
varying vec2 vUv;

float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

void main() {
  vec2 p = vUv * iResolution;
  float w = iResolution.x;
  float h = iResolution.y;
  float padX = 16.0 * scale;
  float padY = 14.0 * scale;
  float spotX = mix(padX, w - padX, fract(iTime * 0.11));

  float minD = 1e5;
  float curveY = -1.0;
  float spotY = -1.0;
  vec2 first = vec2(0.0);
  vec2 last = vec2(0.0);
  vec2 previous = vec2(0.0);
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    float fi = float(i);
    if (fi >= count) break;
    // Each point bobs gently, out of step with its neighbours, so the curve feels alive like the radar.
    float bob = sin(iTime * 0.9 + fi * 1.7) * 1.6 * scale;
    vec2 point = vec2(mix(padX, w - padX, fi / (count - 1.0)), mix(padY, h - padY, values[i]) + bob);
    if (i > 0) {
      vec2 pa = p - previous;
      vec2 ba = point - previous;
      float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      minD = min(minD, length(pa - ba * t));
      if (p.x >= previous.x && p.x <= point.x) curveY = mix(previous.y, point.y, (p.x - previous.x) / max(point.x - previous.x, 0.001));
      if (spotX >= previous.x && spotX <= point.x) spotY = mix(previous.y, point.y, (spotX - previous.x) / max(point.x - previous.x, 0.001));
    }
    if (i == 0) first = point;
    previous = point;
    last = point;
  }
  // The area under the curve carries on flat past both ends, so it fades with the edges instead of stopping square.
  if (p.x < first.x) curveY = first.y;
  if (p.x > last.x) curveY = last.y;
  float d = minD / scale;

  // Everything fades out softly near the edges of the drawing area, so no glow is ever cut off sharply.
  float edge = smoothstep(0.0, 18.0 * scale, p.x) * smoothstep(0.0, 18.0 * scale, w - p.x) * smoothstep(0.0, 14.0 * scale, p.y) * smoothstep(0.0, 8.0 * scale, h - p.y);

  // Faint dashed guides, then the area under the curve fading toward the bottom.
  vec3 col = vec3(0.0);
  for (int g = 1; g <= 3; g++) {
    float gy = h * float(g) / 4.0;
    float dash = step(mod(p.x / scale, 8.0), 3.0);
    col += vec3(0.07) * dash * smoothstep(1.0 * scale, 0.0, abs(p.y - gy));
  }
  if (curveY > 0.0 && p.y < curveY) col += color * 0.26 * pow(p.y / curveY, 1.6);

  float core = smoothstep(1.4, 0.4, d);
  float glow = light2(1.0, 0.05, d);
  float spot = spotY > 0.0 ? light2(1.0, 0.012, distance(p, vec2(spotX, spotY)) / scale) * light2(1.0, 0.08, d) : 0.0;
  float pulse = 0.65 + 0.35 * sin(iTime * 2.4);
  float dl = distance(p, last) / scale;
  float marker = smoothstep(3.6, 2.4, dl) + light2(1.0, 0.03, dl) * pulse * 0.8;

  col += color * glow * 0.75;
  col += mix(color, vec3(1.0), 0.35) * core;
  col += mix(color, vec3(1.0), 0.5) * (spot * 0.9 + marker * 0.8);
  gl_FragColor = vec4(clamp(background + col * edge, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Chart shader compilation failed.");
  return shader;
}
const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

// `values`: results from 0 to 1, oldest first (the last MAX_POINTS are drawn; a single value draws a flat line).
export function GlowChart({ values, color, background = "#0A0A0C", height = 76, active = true }) {
  const valuesRef = useRef(values);
  const colorRef = useRef(color);
  const frameRef = useRef(null);
  const aliveRef = useRef(true);
  const activeRef = useRef(active);
  const renderRef = useRef(null);
  valuesRef.current = values;
  colorRef.current = color;

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
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Chart shader link failed.");
    const position = gl.getAttribLocation(program, "position");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const uniform = (name) => gl.getUniformLocation(program, name);
    const uniforms = { time: uniform("iTime"), resolution: uniform("iResolution"), scale: uniform("scale"), count: uniform("count"), values: uniform("values"), color: uniform("color"), background: uniform("background") };
    const [br, bg, bb] = hexToRgb(background);

    function render(timestamp) {
      frameRef.current = null;
      if (!aliveRef.current) return;
      const width = gl.drawingBufferWidth;
      const heightPx = gl.drawingBufferHeight;
      const points = valuesRef.current.slice(-MAX_POINTS);
      const drawn = points.length === 1 ? [points[0], points[0]] : points;
      const padded = new Float32Array(MAX_POINTS);
      drawn.forEach((value, index) => { padded[index] = Math.max(0, Math.min(1, value)); });
      gl.viewport(0, 0, width, heightPx);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, timestamp * 0.001);
      gl.uniform2f(uniforms.resolution, width, heightPx);
      gl.uniform1f(uniforms.scale, heightPx / height);
      gl.uniform1f(uniforms.count, drawn.length);
      gl.uniform1fv(uniforms.values, padded);
      gl.uniform3fv(uniforms.color, new Float32Array(hexToRgb(colorRef.current)));
      gl.uniform3f(uniforms.background, br, bg, bb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endFrameEXP?.();
      if (activeRef.current) frameRef.current = requestAnimationFrame(render);
    }
    renderRef.current = render;
    render(0);
  }

  return <GLView pointerEvents="none" style={[styles.gl, { height, backgroundColor: background }]} msaaSamples={0} onContextCreate={onContextCreate} />;
}

const styles = StyleSheet.create({ gl: { width: "100%" } });
