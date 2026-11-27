import { Link, useParams } from "react-router-dom";
import { MeetupChat } from "../components/MeetupChat";

export default function MeetupChatPage() {
  const { meetupId } = useParams();
  if (!meetupId || !/^[1-9]\d*$/.test(meetupId)) {
    return <p className="p-4">Meetup not found.</p>;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">Meetup chat</h1>
        <Link to="/" className="inline-flex min-h-11 items-center text-sm text-ink-dim underline">
          Back to overview
        </Link>
      </header>
      <MeetupChat meetupId={meetupId} standalone />
    </div>
  );
}
