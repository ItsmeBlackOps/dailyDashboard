const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function deriveDisplayNameFromEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [localPart] = email.trim().split('@');
  if (!localPart) return '';

  const segments = localPart.split(/[._\s-]+/).filter(Boolean);
  if (segments.length === 0) {
    return '';
  }

  return segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function formatNameInput(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const trimmed = value.toString().trim();
  if (!trimmed) {
    return '';
  }

  if (EMAIL_REGEX.test(trimmed.toLowerCase())) {
    return deriveDisplayNameFromEmail(trimmed);
  }

  return trimmed.replace(/\s+/g, ' ');
}
