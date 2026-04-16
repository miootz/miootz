"""SSE fan-out for session roster/detail changes (distinct from chat SSE)."""

import asyncio
from typing import Dict, Set


class SessionDataEventManager:
    def __init__(self) -> None:
        self.sessions: Dict[int, Set[asyncio.Queue]] = {}

    async def subscribe(self, session_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        if session_id not in self.sessions:
            self.sessions[session_id] = set()
        self.sessions[session_id].add(queue)
        return queue

    async def unsubscribe(self, session_id: int, queue: asyncio.Queue) -> None:
        if session_id in self.sessions:
            self.sessions[session_id].discard(queue)
            if not self.sessions[session_id]:
                del self.sessions[session_id]

    async def broadcast(self, session_id: int, message: dict) -> None:
        if session_id in self.sessions:
            for queue in self.sessions[session_id]:
                await queue.put(message)


session_data_manager = SessionDataEventManager()
