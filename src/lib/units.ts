// SVG -> mm unit conversion helpers.
// CSS reference pixel = 1/96 inch, which is what browsers use for unitless SVG lengths.
const MM_PER_INCH = 25.4;
const PX_PER_INCH = 96;
const MM_PER_PX = MM_PER_INCH / PX_PER_INCH; // 0.264583...

const UNIT_TO_MM: Record<string, number> = {
  px: MM_PER_PX,
  in: MM_PER_INCH,
  mm: 1,
  cm: 10,
  pt: MM_PER_INCH / 72,
  pc: MM_PER_INCH / 6,
  "": MM_PER_PX,
};

/** Parses an SVG length string (e.g. "100", "100px", "10mm", "4in") into millimeters. */
export function lengthToMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([+-]?[0-9]*\.?[0-9]+)\s*([a-z%]*)\s*$/i.exec(value);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "%") return null; // percentage requires context we don't have here
  const factor = UNIT_TO_MM[unit];
  if (factor === undefined) return null;
  return num * factor;
}

export const PX_TO_MM = MM_PER_PX;
