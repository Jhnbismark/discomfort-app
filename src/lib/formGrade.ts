/** One verdict per form score — the app never softens a number, it names it.
 *  Used on the result screen and stamped onto receipts. */
export interface FormGrade {
  word: string;
  /** tailwind text color class for the verdict */
  cls: string;
  /** canvas color for receipts */
  hex: string;
}

export function formGrade(score: number): FormGrade {
  if (score >= 95) return { word: 'FLAWLESS', cls: 'text-earn', hex: '#9be564' };
  if (score >= 85) return { word: 'CLEAN', cls: 'text-earn/80', hex: '#9be564' };
  if (score >= 70) return { word: 'ROUGH', cls: 'text-bone/60', hex: '#ededea' };
  return { word: 'SLOPPY', cls: 'text-fault', hex: '#e5484d' };
}
