import type { MappingTemplate } from "./types";

const fallbackScaleSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff7e2"/>
      <stop offset="100%" stop-color="#e5bc63"/>
    </radialGradient>
  </defs>
  <circle cx="450" cy="450" r="390" fill="url(#bg)" stroke="#4b3512" stroke-width="10"/>
  <circle cx="450" cy="450" r="290" fill="none" stroke="#7f5a1d" stroke-width="4" stroke-dasharray="10 12"/>
  <line x1="450" y1="80" x2="450" y2="820" stroke="#4b3512" stroke-width="5"/>
  <line x1="80" y1="450" x2="820" y2="450" stroke="#4b3512" stroke-width="5"/>
  <line x1="188" y1="188" x2="712" y2="712" stroke="#7f5a1d" stroke-width="3"/>
  <line x1="712" y1="188" x2="188" y2="712" stroke="#7f5a1d" stroke-width="3"/>
  <polygon points="450,82 480,150 450,136 420,150" fill="#9f1f16"/>
  <text x="450" y="132" text-anchor="middle" font-size="34" font-family="Georgia, serif" font-weight="700" fill="#ffffff">N</text>
  <text x="450" y="210" text-anchor="middle" font-size="26" font-family="Georgia, serif" font-weight="700" fill="#4b3512">North</text>
  <text x="450" y="726" text-anchor="middle" font-size="26" font-family="Georgia, serif" font-weight="700" fill="#4b3512">South</text>
  <text x="728" y="458" text-anchor="middle" font-size="26" font-family="Georgia, serif" font-weight="700" fill="#4b3512">East</text>
  <text x="172" y="458" text-anchor="middle" font-size="26" font-family="Georgia, serif" font-weight="700" fill="#4b3512">West</text>
  <text x="640" y="260" text-anchor="middle" font-size="22" font-family="Georgia, serif" fill="#4b3512">NE</text>
  <text x="640" y="640" text-anchor="middle" font-size="22" font-family="Georgia, serif" fill="#4b3512">SE</text>
  <text x="260" y="640" text-anchor="middle" font-size="22" font-family="Georgia, serif" fill="#4b3512">SW</text>
  <text x="260" y="260" text-anchor="middle" font-size="22" font-family="Georgia, serif" fill="#4b3512">NW</text>
</svg>
`);

export const DEFAULT_MAPPING_TEMPLATE: MappingTemplate = {
  id: "default-vastu-template",
  name: "Default Vastu Scale",
  imageDataUrl: `data:image/svg+xml;charset=utf-8,${fallbackScaleSvg}`,
  width: 900,
  height: 900,
  anchors: [
    { x: 450, y: 136 },
    { x: 450, y: 726 },
  ],
  labels: [
    { id: "north", text: "North", x: 450, y: 210 },
    { id: "south", text: "South", x: 450, y: 726 },
    { id: "east", text: "East", x: 728, y: 458 },
    { id: "west", text: "West", x: 172, y: 458 },
    { id: "north-east", text: "NE", x: 640, y: 260 },
    { id: "south-east", text: "SE", x: 640, y: 640 },
    { id: "south-west", text: "SW", x: 260, y: 640 },
    { id: "north-west", text: "NW", x: 260, y: 260 },
  ],
};
