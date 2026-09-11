import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlusOneClaimPage } from './PlusOneClaimPage';
import { useAuth } from '../auth/useAuth';
import { checkPlusOneClaim, claimPlusOne } from '../api/sessionsApi';

vi.mock('../auth/useAuth');
vi.mock('../api/sessionsApi');
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../utils/haptics', () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn() }));
const login = vi.fn();
const signedOut = { me: null, loading: false, error: null, tokens: null, login, logout: vi.fn(), refresh: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/plus-one/test-claim');
  vi.mocked(useAuth).mockReturnValue(signedOut);
  vi.mocked(checkPlusOneClaim).mockResolvedValue({ id: 1, status: 'pending', first_name: 'Ioana', last_name: 'Radu', self_assessed_skill: 3, session_id: 1, inviter_display_name: 'Mara', guest_display_name: 'Ioana Radu' });
});

function openClaim() {
  render(<MemoryRouter initialEntries={['/plus-one/test-claim']}><Routes><Route path="/plus-one/:token" element={<PlusOneClaimPage />} /></Routes></MemoryRouter>);
}

it('shows the inviter and saves the reservation path before sign-in', async () => {
  openClaim();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to claim' }));
  expect(screen.getByText('Invited by Mara')).toBeInTheDocument();
  expect(sessionStorage.getItem('miootz_return_path')).toBe('/plus-one/test-claim');
  expect(login).toHaveBeenCalledOnce();
  expect(claimPlusOne).not.toHaveBeenCalled();
});

it('claims with the signed-in identity without asking for a username', async () => {
  vi.mocked(useAuth).mockReturnValue({ ...signedOut, me: { user: { id: 20, display_name: 'Ioana Radu', pocket_id_sub: 'guest', avatar_url: null, self_assessed_skill: 3, calculated_skill: null, primary_specialty: null, secondary_specialty: null, is_admin: false }, is_admin: false, auth_groups: ['members'] } });
  vi.mocked(claimPlusOne).mockResolvedValue({ status: 'claimed', user_id: 20, display_name: 'Ioana Radu', self_assessed_skill: 3 });
  openClaim();
  fireEvent.click(await screen.findByRole('button', { name: 'Claim my reservation' }));
  expect(await screen.findByRole('heading', { name: 'Your reservation is claimed' })).toBeInTheDocument();
  expect(claimPlusOne).toHaveBeenCalledWith('test-claim');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
