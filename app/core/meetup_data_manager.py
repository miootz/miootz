"""SSE fan-out for meetup roster/detail changes (distinct from chat SSE)."""

import asyncio


class MeetupDataEventManager:
    def __init__(self) -> None:
        self.meetups: dict[int | None, set[asyncio.Queue]] = {}

    async def subscribe(self, meetup_id: int | None) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        if meetup_id not in self.meetups:
            self.meetups[meetup_id] = set()
        self.meetups[meetup_id].add(queue)
        return queue

    async def unsubscribe(self, meetup_id: int | None, queue: asyncio.Queue) -> None:
        if meetup_id in self.meetups:
            self.meetups[meetup_id].discard(queue)
            if not self.meetups[meetup_id]:
                del self.meetups[meetup_id]

    async def broadcast(self, meetup_id: int | None, message: dict) -> None:
        if meetup_id in self.meetups:
            for queue in self.meetups[meetup_id]:
                await queue.put(message)


meetup_data_manager = MeetupDataEventManager()
