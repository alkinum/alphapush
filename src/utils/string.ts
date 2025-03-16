/**
 * Convert snake_case or kebab-case to Title Case
 * @param str The string to format
 * @returns The formatted string
 */
export function formatName(str: string): string {
  if (!str) return '';

  // Handle snake_case and kebab-case
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, (word) => {
      return word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
    });
}