import Svg, { Circle, Line, Path } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";

// The angle to estimate: two rays from a vertex, and an arc marking the angle between them, swept clockwise
// from the first ray (so a reflex angle shows as the long way round). `rotation` turns the whole figure. The
// vertex sits at the centre so the figure fits whatever the rotation.
export function AngleFigure({ angle, rotation = 0, size = 172, stroke = 4 }) {
  const center = size / 2;
  const length = size * 0.44;
  const radius = length * 0.38;
  const point = (degrees, distance) => { const radians = (degrees * Math.PI) / 180; return { x: center + Math.sin(radians) * distance, y: center - Math.cos(radians) * distance }; };
  const first = point(rotation, length);
  const second = point(rotation + angle, length);
  const arcStart = point(rotation, radius);
  const arcEnd = point(rotation + angle, radius);
  return <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <Path d={`M${arcStart.x} ${arcStart.y} A${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${arcEnd.x} ${arcEnd.y}`} fill="none" stroke={SPACE_CADET.mentalMath} strokeWidth={Math.max(1.5, stroke * 0.55)} strokeLinecap="round" />
    <Line x1={center} y1={center} x2={first.x} y2={first.y} stroke={SPACE_CADET.white} strokeWidth={stroke} strokeLinecap="round" />
    <Line x1={center} y1={center} x2={second.x} y2={second.y} stroke={SPACE_CADET.white} strokeWidth={stroke} strokeLinecap="round" />
    <Circle cx={center} cy={center} r={stroke * 1.15} fill={SPACE_CADET.mentalMath} />
  </Svg>;
}
