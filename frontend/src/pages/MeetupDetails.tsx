import React from 'react';
import type { Session } from '../types';
import { PlayerCard } from '../components/PlayerCard';
import { DraggableTeams } from '../components/DraggableTeams';
import { SessionChat } from '../components/SessionChat';

interface MeetupDetailsProps {
  session: Session;
  onToggleLock: (userId: string) => void;
  onMovePlayer: (playerId: string, sourceTeamId: string, destTeamId: string) => void;
}

export const MeetupDetails: React.FC<MeetupDetailsProps> = ({ session, onToggleLock, onMovePlayer }) => {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Meetup Details</h1>
        <p className="text-gray-500 dark:text-gray-400">{session.date}</p>
        {session.location && (
          <p className="text-gray-600 dark:text-gray-300">{session.location}</p>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Attendance List */}
        <section className="lg:col-span-1 space-y-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2">Attendance</h2>
          <div className="grid gap-3">
            {session.attendance.map(player => (
              <PlayerCard key={player.id} player={player} onToggleLock={onToggleLock} />
            ))}
          </div>
        </section>

        {/* Teams Grid */}
        <section className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2">Teams</h2>
          <DraggableTeams 
            session={session} 
            onToggleLock={onToggleLock} 
            onMovePlayer={onMovePlayer} 
          />
        </section>
      </div>

      {/* Chat Section */}
      <section className="max-w-2xl mx-auto w-full">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2 mb-4">Chat</h2>
        <SessionChat sessionId={session.id} />
      </section>
    </div>
  );
};
