import Svg, { Circle, Path } from "react-native-svg";

// House_01 and User_01 are from coolicons (https://coolicons.cool) by Kryston Schwarze, CC BY 4.0. RadarIcon is drawn in the same style.
export const strokeProps = { fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

// Pointy-top hexagon whose corners are softened with quadratic curves (`cut` = distance from each vertex where the rounding starts).
function roundedHexagonPath(radius, cut) {
  const vertices = Array.from({ length: 6 }, (_, index) => {
    const angle = ((-90 + index * 60) * Math.PI) / 180;
    return [12 + radius * Math.cos(angle), 12 + radius * Math.sin(angle)];
  });
  const towards = (from, to) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [from[0] + ((to[0] - from[0]) / length) * cut, from[1] + ((to[1] - from[1]) / length) * cut];
  };
  const point = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const corners = vertices.map((vertex, index) => ({ vertex, start: towards(vertex, vertices[(index + 5) % 6]), end: towards(vertex, vertices[(index + 1) % 6]) }));
  return `M${point(corners[0].start)}${corners.map(({ vertex, end }, index) => `Q${point(vertex)} ${point(end)}L${point(corners[(index + 1) % 6].start)}`).join("")}Z`;
}

const HEXAGON_PATH = roundedHexagonPath(10, 2.8);

export function HomeIcon({ color, size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path {...strokeProps} stroke={color} d="M20 17v-5.548c0-.534 0-.801-.065-1.05a2 2 0 0 0-.28-.617c-.145-.213-.345-.39-.748-.741l-4.8-4.2c-.746-.653-1.12-.98-1.54-1.104c-.37-.11-.764-.11-1.135 0c-.42.124-.792.45-1.538 1.102L5.093 9.044c-.402.352-.603.528-.747.74a2 2 0 0 0-.281.618C4 10.65 4 10.918 4 11.452V17c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.082 1.083C5.602 20 6.068 20 7 20s1.398 0 1.766-.152a2 2 0 0 0 1.082-1.083C10 18.398 10 17.932 10 17v-1a2 2 0 1 1 4 0v1c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.082 1.083C15.602 20 16.068 20 17 20s1.398 0 1.766-.152a2 2 0 0 0 1.082-1.083C20 18.398 20 17.932 20 17" /></Svg>;
}

export function UserIcon({ color, size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path {...strokeProps} stroke={color} d="M19 21a7 7 0 1 0-14 0m7-10a4 4 0 1 1 0-8a4 4 0 0 1 0 8" /></Svg>;
}

export function RadarIcon({ color, size = 26 }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path {...strokeProps} stroke={color} d={HEXAGON_PATH} /><Circle {...strokeProps} stroke={color} cx="12" cy="12" r="2.75" /></Svg>;
}
