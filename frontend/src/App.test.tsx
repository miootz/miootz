import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { Link, MemoryRouter, Outlet } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import App, { RouteLoadBoundary } from './App';

vi.mock('./pages/PlayerHome', () => ({ PlayerHome: () => <p>Player home</p> }));
vi.mock('./pages/PlayerApp', () => ({ PlayerApp: () => null }));
vi.mock('./layout/MemberLayout', () => ({
  MemberLayout: () => <><nav><Link to="/">Meetup</Link><Link to="/rankings">Rankings</Link></nav><Outlet /></>,
}));
const rankingsChunk = vi.hoisted(() => {
  let resolve!: () => void;
  return { ready: new Promise<void>((done) => { resolve = done; }), finish: () => resolve(), started: vi.fn() };
});
vi.mock('./pages/RankingsPage', async () => {
  rankingsChunk.started();
  await rankingsChunk.ready;
  return { RankingsPage: () => <h1>Player rankings</h1> };
});
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


it('warms the destination on link intent and keeps navigation visible during a cold route', async () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'Rankings' });
  fireEvent.focusIn(link);
  await waitFor(() => expect(rankingsChunk.started).toHaveBeenCalledOnce());
  expect(screen.getByText('Player home')).toBeVisible();

  fireEvent.click(link);
  expect(link).toBeVisible();
  expect(document.querySelector('img[src*="splash"]')).toBeNull();

  await act(async () => rankingsChunk.finish());
  expect(await screen.findByRole('heading', { name: 'Player rankings' })).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Meetup' }));
  await screen.findByText('Player home');
  fireEvent.click(link);
  expect(await screen.findByRole('heading', { name: 'Player rankings' })).toBeVisible();
  expect(rankingsChunk.started).toHaveBeenCalledOnce();
});
