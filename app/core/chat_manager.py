import asyncio


class ChatManager:
    def __init__(self):
        # Maps meetup_id to a set of active queues
        self.meetups: dict[int, set[asyncio.Queue]] = {}

    async def subscribe(self, meetup_id: int) -> asyncio.Queue:
        queue = asyncio.Queue()
        if meetup_id not in self.meetups:
            self.meetups[meetup_id] = set()
        self.meetups[meetup_id].add(queue)
        return queue

    async def unsubscribe(self, meetup_id: int, queue: asyncio.Queue):
        if meetup_id in self.meetups:
            self.meetups[meetup_id].remove(queue)
            if not self.meetups[meetup_id]:
                del self.meetups[meetup_id]

    async def broadcast(self, meetup_id: int, message: dict):
        if meetup_id in self.meetups:
            for queue in self.meetups[meetup_id]:
                await queue.put(message)


chat_manager = ChatManager()
