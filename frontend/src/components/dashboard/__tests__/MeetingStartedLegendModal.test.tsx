import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MeetingStartedLegendModal } from '../MeetingStartedLegendModal';

beforeEach(() => localStorage.clear());
// vitest `globals` is off in this repo → RTL auto-cleanup isn't registered.
afterEach(cleanup);

describe('MeetingStartedLegendModal', () => {
  it('shows once when unseen and sets the flag on dismiss', () => {
    render(<MeetingStartedLegendModal />);
    expect(screen.getByText(/Meeting status indicator/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(localStorage.getItem('prt.seenMeetingStartedLegend')).toBe('1');
  });
  it('does not show when already seen', () => {
    localStorage.setItem('prt.seenMeetingStartedLegend', '1');
    render(<MeetingStartedLegendModal />);
    expect(screen.queryByText(/Meeting status indicator/i)).toBeNull();
  });
});
