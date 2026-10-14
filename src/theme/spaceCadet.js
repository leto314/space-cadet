export const SPACE_CADET = {
  black: "#000000", surface1: "#0A0A0C", surface2: "#131316", surface3: "#1D1D21", surface4: "#28282D", white: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.64)", textTertiary: "rgba(255,255,255,0.40)", borderSubtle: "rgba(255,255,255,0.08)", borderDefault: "rgba(255,255,255,0.14)",
  spatial: "#4C8DFF", attention: "#D81E5B", memory: "#B8FF3D", mentalMath: "#C46BFF", multitasking: "#FFAD1F",
  logic: "#5EEBEB",
};

export const CATEGORY_CONFIG = {
  spatial: { label: "Spatial Orientation", color: SPACE_CADET.spatial },
  attention: { label: "Attention", color: SPACE_CADET.attention },
  memory: { label: "Memory", color: SPACE_CADET.memory },
  mentalMath: { label: "Mental Math", color: SPACE_CADET.mentalMath },
  logic: { label: "Logic", color: SPACE_CADET.logic },
  multitasking: { label: "Multitasking", color: SPACE_CADET.multitasking },
};

export const CATEGORY_COLORS = Object.fromEntries(Object.entries(CATEGORY_CONFIG).map(([key, value]) => [key, value.color]));

export function getCategoryLabel(categoryKey) {
  return CATEGORY_CONFIG[categoryKey]?.label ?? categoryKey;
}

export const GAME_SETUP_META = {
  "Spatial Orientation": { categoryKey: "spatial" },
  "Cube Rotation": { categoryKey: "spatial" },
  "Cube Nets": { categoryKey: "spatial" },
  "Heading and Beacon": { categoryKey: "spatial" },
  "Turn Count": { categoryKey: "spatial" },
  "Reaction Time": { categoryKey: "attention" },
  "Selective Attention": { categoryKey: "attention" },
  "Symbol Radar": { title: "Anomaly Detection", categoryKey: "attention" },
  "Visual Scan": { categoryKey: "attention" },
  "Switchboard": { categoryKey: "logic" },
  "Landing Order": { categoryKey: "logic" },
  "Pattern Matrix": { categoryKey: "logic" },
  "Circuits": { categoryKey: "logic" },
  "Memory Sequences": { categoryKey: "memory" },
  "N-back": { categoryKey: "memory" },
  "Visual Memory": { categoryKey: "memory" },
  "Flash Math": { categoryKey: "mentalMath" },
  "Running Total": { categoryKey: "mentalMath" },
  "Estimation": { categoryKey: "mentalMath" },
  "Multitasking": { title: "Target Drift", categoryKey: "multitasking" },
  "Target Drift": { categoryKey: "multitasking" },
  "Airways": { categoryKey: "multitasking" },
};
