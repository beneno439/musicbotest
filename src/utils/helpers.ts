export function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function geniusSearchUrl(title: string, artist: string): string {
  return `https://genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}
