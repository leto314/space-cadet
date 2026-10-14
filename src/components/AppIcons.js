import Svg, { Circle, Path, Rect } from "react-native-svg";

import { strokeProps } from "./NavIcons";

// Compass and Bulb are from coolicons (https://coolicons.cool) by Kryston Schwarze, CC BY 4.0. The others are drawn in the same style.
function Glyph({ color, size, children }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} {...strokeProps}>{children}</Svg>;
}

export function CompassIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0" /><Path d="M10.5 10.5L16 8l-2.5 5.5L8 16z" /></Glyph>;
}

export function BulbIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Path d="M9 21h6M12 3a6 6 0 0 0-5.019 9.29c.954 1.452 1.43 2.178 1.493 2.286c.55.965.449.625.518 1.734c.008.124.008.313.008.69a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1c0-.377 0-.566.008-.69c.07-1.11-.033-.769.518-1.734c.062-.108.54-.834 1.493-2.287A6 6 0 0 0 12 3" /></Glyph>;
}

export function NodesIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Circle cx="6.5" cy="17.5" r="2.5" /><Circle cx="17.5" cy="6.5" r="2.5" /><Path d="M8.3 15.7l7.4-7.4" /></Glyph>;
}

export function TargetIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Circle cx="12" cy="12" r="9" /><Circle cx="12" cy="12" r="4.5" /><Path d="M12 12v.01" /></Glyph>;
}

export function MathIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Path d="M7 3.8v6.4M3.8 7h6.4" /><Path d="M13.8 7h6.4" /><Path d="M4.2 14.2l5.6 5.6M9.8 14.2l-5.6 5.6" /><Path d="M13.8 17h6.4M17 14.3v.01M17 19.7v.01" /></Glyph>;
}

export function BlocksIcon({ color, size = 24 }) {
  return <Glyph color={color} size={size}><Rect x="4" y="4" width="7" height="16" rx="2" /><Rect x="13" y="4" width="7" height="7" rx="2" /><Rect x="13" y="13" width="7" height="7" rx="2" /></Glyph>;
}

export const CATEGORY_ICONS = { spatial: CompassIcon, logic: BulbIcon, memory: NodesIcon, attention: TargetIcon, mentalMath: MathIcon, multitasking: BlocksIcon };
