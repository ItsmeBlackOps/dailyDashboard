import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JobRow from './JobRow';
import type { Job } from './types';

const JOB: Job = {
  id: 'j1',
  title: 'Senior Frontend Engineer',
  company: 'Acme Corp',
  location: 'San Francisco, California, United States',
  remote_type: 'hybrid',
  ats: 'greenhouse',
  url: 'https://example.com/jobs/1',
  date_posted: '2026-04-20T00:00:00Z',
  snippet: 'Build great UIs.',
  skills: ['React', 'TypeScript'],
};

describe('JobRow', () => {
  it('renders job title and company', () => {
    render(
      <JobRow job={JOB} selected={false} starred={false} onSelect={() => {}} onStar={() => {}} />,
    );
    expect(screen.getByText('Senior Frontend Engineer')).toBeTruthy();
    expect(screen.getByText('Acme Corp')).toBeTruthy();
  });

  it('fires onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(
      <JobRow job={JOB} selected={false} starred={false} onSelect={onSelect} onStar={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('job-row'));
    expect(onSelect).toHaveBeenCalledWith(JOB);
  });

  it('star toggle fires onStar and does not bubble to onSelect', () => {
    const onStar = vi.fn();
    const onSelect = vi.fn();
    render(
      <JobRow job={JOB} selected={false} starred={false} onSelect={onSelect} onStar={onStar} />,
    );
    fireEvent.click(screen.getByTestId('star-btn'));
    expect(onStar).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows filled star when starred', () => {
    render(
      <JobRow job={JOB} selected={false} starred={true} onSelect={() => {}} onStar={() => {}} />,
    );
    const btn = screen.getByTestId('star-btn');
    expect(btn.classList.contains('text-amber-400')).toBe(true);
  });
});
