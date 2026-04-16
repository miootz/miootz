import asyncio
from typing import Dict, Set


class ChatManager:
    def __init__(self):
        # Maps session_id to a set of active queues
        self.sessions: Dict[int, Set[asyncio.Queue]] = {}

    async def subscribe(self, session_id: int) -> asyncio.Queue:
        queue = asyncio.Queue()
        if session_id not in self.sessions:
            self.sessions[session_id] = set()
        self.sessions[session_id].add(queue)
        return queue

    async def unsubscribe(self, session_id: int, queue: asyncio.Queue):
        if session_id in self.sessions:
            self.sessions[session_id].remove(queue)
            if not self.sessions[session_id]:
                del self.sessions[session_id]

    async def broadcast(self, session_id: int, message: dict):
        if session_id in self.sessions:
            for queue in self.sessions[session_id]:
                await queue.put(message)


chat_manager = ChatManager()
