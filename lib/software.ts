export const SOFTWARE = [
  { id: "bryce", name: "Bryce" },
  { id: "blender", name: "Blender" },
  { id: "daz-studio", name: "DAZ Studio" },
  { id: "vue", name: "Vue" },
  { id: "terragen", name: "Terragen" },
  { id: "other", name: "Other software" },
] as const;
export function validSoftware(value: string) {
  return SOFTWARE.some((s) => s.id === value);
}
export function softwareName(value: string) {
  return SOFTWARE.find((s) => s.id === value)?.name || "Other software";
}
