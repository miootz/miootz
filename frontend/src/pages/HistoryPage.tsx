import React, { useState } from 'react';
import type { GameSession, MatchSummary } from '../types';

interface HistoryPageProps {
  sessions: GameSession[];
  onUpdateMatch: (sessionId: string, matchId: string, updates: Partial<MatchSummary>) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ sessions, onUpdateMatch }) => {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Match History</h1>
        <p className="text-gray-500 dark:text-gray-400">Review and edit previous game results</p>
      </header>

      <div className="space-y-4">
        {sessions.map(session => (
          <div key={session.id} className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900 transition-colors">
            <button 
              onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
              className="w-full flex justify-between items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="text-left">
                <span className="font-bold text-lg text-gray-900 dark:text-white">{session.date}</span>
                <span className="ml-3 text-sm text-gray-500">{session.attendance.length} Players</span>
              </div>
              <span className="text-purple-600 dark:text-purple-400 font-medium">
                {expandedSession === session.id ? 'Collapse' : 'View Matches'}
              </span>
            </button>

            {expandedSession === session.id && (
              <div className="p-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 space-y-4">
                {session.matches.length > 0 ? (
                  session.matches.map(match => (
                    <div key={match.matchId} className="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                      <div className="flex items-center justify-center space-x-4 font-bold text-xl">
                        <input 
                          type="number" 
                          value={match.scoreA} 
                          onChange={(e) => onUpdateMatch(session.id, match.matchId, { scoreA: parseInt(e.target.value) || 0 })}
                          className="w-12 p-1 text-center border rounded dark:bg-gray-800 dark:text-white"
                        />
                        <span>-</span>
                        <input 
                          type="number" 
                          value={match.scoreB} 
                          onChange={(e) => onUpdateMatch(session.id, match.matchId, { scoreB: parseInt(e.target.value) || 0 })}
                          className="w-12 p-1 text-center border rounded dark:bg-gray-800 dark:text-white"
                        />
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                        Match {match.matchId}
                      </div>
                      <input 
                        type="text" 
                        value={match.notes} 
                        placeholder="Add notes..."
                        onChange={(e) => onUpdateMatch(session.id, match.matchId, { notes: e.target.value })}
                        className="p-2 text-sm border rounded dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                  ))
                ) : (
                  <p className="text-center text-gray-500 py-4">No match summaries recorded for this session.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
