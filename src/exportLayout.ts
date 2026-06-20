const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const formatReportDate = (date: Date): string =>
  `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

export const fitContain = (
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } => {
  const ratio = Math.min(boxW / srcW, boxH / srcH);
  return { width: srcW * ratio, height: srcH * ratio };
};
