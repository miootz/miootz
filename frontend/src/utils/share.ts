export interface ShareMeetupPayload {
  title: string;
  text: string;
  url: string;
}

export async function shareMeetup(payload: ShareMeetupPayload): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return false;
    }
  }
  try {
    await navigator.clipboard.writeText(payload.url);
    return true;
  } catch {
    return false;
  }
}
