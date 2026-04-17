import { useState } from 'react';
import type { SessionListItem } from '../api/sessionsApi';
import { SessionRatingsPanel } from '../components/SessionRatingsPanel';
import { parseSessionStart } from '../utils/datetime';

interface HistoryPageProps {
  pastSessions: SessionListItem[];
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ pastSessions }) => {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Match History</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Past meetups — rate teammates after each session (anonymous).
        </p>
      </header>

      {pastSessions.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
          No past sessions yet.
        </p>
      ) : (
        <div className="space-y-4">
          {pastSessions.map((row) => {
            const idStr = String(row.id);
            const day =
              row.start_time.length >= 10
                ? row.start_time.slice(0, 10)
                : parseSessionStart(row.start_time).toISOString().slice(0, 10);

            return (
              <div
                key={row.id}
                className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900 transition-colors"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSession(expandedSession === idStr ? null : idStr)
                  }
                  className="w-full flex justify-between items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="text-left">
                    <span className="font-bold text-lg text-gray-900 dark:text-white">
                      {day}
                    </span>
                    <span className="ml-3 text-sm text-gray-500">{row.location}</span>
                  </div>
                  <span className="text-purple-600 dark:text-purple-400 font-medium">
                    {expandedSession === idStr ? 'Collapse' : 'Details & ratings'}
                  </span>
                </button>

                {expandedSession === idStr && (
                  <div className="p-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 space-y-6">
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Player ratings
                      </h3>
                      <SessionRatingsPanel sessionId={row.id} />
                    </section>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
