import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MeetingStartedChip } from '../MeetingStartedChip';

// This repo's vitest config does not enable `globals`, so React Testing
// Library's automatic per-test cleanup is not registered. Unmount manually
// so renders from one test don't leak DOM into the next.
afterEach(cleanup);

describe('MeetingStartedChip', () => {
  it('renders nothing for Cancelled/Completed', () => {
    const { container } = render(<MeetingStartedChip started={false} canMark status="Cancelled" onMark={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('started → green read-only indicator, no button', () => {
    render(<MeetingStartedChip started startedBy="exp@x.com" startedAt="9:02 AM EST" canMark={false} status="" onMark={() => {}} />);
    expect(screen.getByLabelText(/Expert joined at 9:02 AM EST/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('not started + canMark → clickable, calls onMark', () => {
    const onMark = vi.fn();
    render(<MeetingStartedChip started={false} canMark status="" onMark={onMark} />);
    fireEvent.click(screen.getByRole('button', { name: /mark meeting started/i }));
    expect(onMark).toHaveBeenCalled();
  });
  it('not started + !canMark → indicator only, no button', () => {
    render(<MeetingStartedChip started={false} canMark={false} status="" onMark={() => {}} />);
    expect(screen.getByLabelText(/not started yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
