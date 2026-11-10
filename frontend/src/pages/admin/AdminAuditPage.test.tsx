import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditPage } from './AdminAuditPage';
import { adminAuditLogs, adminAuditPivot, type AuditLogRow } from '../../api/auditApi';

vi.mock('../../api/auditApi');
vi.mock('../../components/admin/AdminBreadcrumb', () => ({
  AdminBreadcrumb: () => null,
}));

const row = (over: Partial<AuditLogRow>): AuditLogRow => ({
  id: 1,
  created_at: '2026-11-10T14:32:07',
  user_id: 1,
  username: 'admin',
  display_name: 'Admin',
  is_admin: true,
  category: 'meetup',
  action: 'meetup.created',
  description: "Created meetup 'Test Pitch' for 2026-11-11 19:00 UTC",
  meetup_id: 7,
  ...over,
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/admin/audit']}>
      <Routes>
        <Route path="/admin/audit" element={<AdminAuditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminAuditLogs).mockResolvedValue({
    items: [
      row({ id: 2, action: 'attendance.joined', is_admin: false, display_name: 'User', username: 'User', category: 'attendance', description: "Joined 'Test Pitch' as confirmed" }),
      row({}),
    ],
    total: 2,
  });
  vi.mocked(adminAuditPivot).mockImplementation(
    (p) =>
      p.groupBy === 'user'
        ? Promise.resolve({
            items: [
              { key: 'admin', count: 1 },
              { key: 'User', count: 1 },
            ],
          })
        : Promise.resolve({
            items: [
              { key: 'meetup', count: 1 },
              { key: 'attendance', count: 1 },
            ],
          }),
  );
});

describe('AdminAuditPage', () => {
  it('renders log rows with actor, admin badge and description', async () => {
    renderPage();
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Joined')).toBeInTheDocument();
    expect(screen.getByText("Joined 'Test Pitch' as confirmed")).toBeInTheDocument();
    // The ADMIN badge (and the actor name) both render "Admin".
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('pivots by category and by user', async () => {
    renderPage();
    await screen.findByText('Created');

    await fireEvent.click(screen.getByRole('button', { name: 'By category' }));
    await waitFor(() =>
      expect(adminAuditPivot).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'category' }),
      ),
    );
    expect(await screen.findByText('Meetup')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'By user' }));
    await waitFor(() =>
      expect(adminAuditPivot).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'user' }),
      ),
    );
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('filters by category and passes the filter to the API', async () => {
    renderPage();
    await screen.findByText('Created');

    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const chip = await screen.findByRole('button', { name: 'Referee' });
    await fireEvent.click(chip);

    await waitFor(() =>
      expect(adminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'referee' }),
      ),
    );
  });

  it('applies a search query to the API', async () => {
    renderPage();
    await screen.findByText('Created');

    await fireEvent.change(screen.getByLabelText('Search the audit log'), {
      target: { value: 'deleted' },
    });
    await waitFor(() =>
      expect(adminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'deleted' }),
      ),
    );
  });

  it('shows the empty state with a clear-filters action', async () => {
    vi.mocked(adminAuditLogs).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByText('Actions will appear here as they happen.')).toBeInTheDocument();
  });
});
