import React, { useState, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { formatRelativeTime, formatAbsoluteTime } from '../utils/time';

interface SessionChatProps {
  sessionId: string;
}

export const SessionChat: React.FC<SessionChatProps> = ({ sessionId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchInitialMessages = async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/chat`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error('Failed to fetch initial messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialMessages();

    const eventSource = new EventSource(`/api/sessions/${sessionId}/chat/events`);

    eventSource.onmessage = (event) => {
      const newMessageData: ChatMessage = JSON.parse(event.data);
      setMessages((prev) => [...prev, newMessageData]);
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage }),
      });

      if (response.ok) {
        setNewMessage('');
        // We don't need to fetchMessages() here because SSE will push the new message
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div className="flex flex-col h-[500px] bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-800 dark:text-white">
        Session Chat
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="text-center text-gray-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500">No messages yet. Start the conversation!</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex flex-col space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{msg.username}</span>
                <span 
                  className="text-[10px] text-gray-400 dark:text-gray-500 cursor-help" 
                  title={formatAbsoluteTime(msg.created_at)}
                >
                  {formatRelativeTime(msg.created_at)}
                </span>
              </div>
              <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg inline-block max-w-[80%] text-gray-800 dark:text-gray-200">
                {msg.message}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 p-2 border rounded-md dark:bg-gray-900 dark:border-gray-600 dark:text-white"
        />
        <button 
          type="submit" 
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
};
