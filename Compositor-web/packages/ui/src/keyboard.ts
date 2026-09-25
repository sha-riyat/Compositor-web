/**
 * La garde commune aux raccourcis globaux : dans un champ de texte, les
 * touches appartiennent au champ — ses chiffres, et son annulation native.
 */
export const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    // Une case à cocher n'est pas un champ de texte : le raccourci doit
    // continuer de marcher quand elle a le focus.
    return !['checkbox', 'radio', 'button', 'range'].includes(target.type);
  }
  return false;
};
