/**
 * Mobile-native Share API wrapper with clipboard fallback.
 * Returns true if sharing succeeded, false if it failed or was cancelled.
 */
export interface ShareMeetupOptions {
	url: string;
	title?: string;
	text?: string;
}

/** Share a meetup using the object-shaped API used by meetup views. */
export function shareMeetup({
	url,
	title,
	text,
}: ShareMeetupOptions): Promise<boolean> {
	return shareLink(url, title, text);
}

export async function shareLink(
	url: string,
	title?: string,
	text?: string,
): Promise<boolean> {
	// Check if Web Share API is available
	if (typeof navigator.share === "function") {
		try {
			await navigator.share({
				title,
				text,
				url,
			});
			return true;
		} catch (err) {
			// User cancelled share or other error
			console.debug("Share cancelled or failed:", err);
			return false;
		}
	}

	// Fallback to clipboard copy
	try {
		await navigator.clipboard.writeText(url);
		return true;
	} catch (err) {
		console.error("Clipboard fallback failed:", err);
		return false;
	}
}
