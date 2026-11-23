import { render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import App, { RouteLoadBoundary } from './App';

vi.mock('./pages/PlayerHome', () => ({ PlayerHome: () => <p>Player home</p> }));
vi.mock('./pages/PlayerApp', () => ({ PlayerApp: () => null }));
vi.mock('./layout/MemberLayout', () => ({ MemberLayout: () => <Outlet /> }));
vi.mock('./auth/RequireAuth', () => ({ RequireAuth: () => <Outlet /> }));
vi.mock('./pages/admin/AdminLayout', () => ({ AdminLayout: () => <Outlet /> }));
vi.mock('./pages/admin/AdminDashboard', () => ({ AdminDashboard: () => <p>Admin dashboard</p> }));
vi.mock('./pages/RefereePage', () => ({ RefereePage: () => <p>Referee control</p> }));

it('offers a manual reload after a page fails to load and recovers on navigation', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const BrokenPage = lazy(async () => { throw new Error('Loading chunk failed'); });
  const view = render(
    <RouteLoadBoundary pathname="/admin">
      <Suspense fallback={<p>Loading</p>}><BrokenPage /></Suspense>
    </RouteLoadBoundary>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be loaded.');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

  view.rerender(<RouteLoadBoundary pathname="/"><p>Player home</p></RouteLoadBoundary>);
  expect(screen.getByText('Player home')).toBeInTheDocument();
  consoleError.mockRestore();
});

it.each([
  ['/', 'Player home'],
  ['/admin', 'Admin dashboard'],
  ['/meetup-matches/1', 'Referee control'],
])('opens the %s route', async (path, text) => {
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  expect(await screen.findByText(text)).toBeInTheDocument();
});
