/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BotStatusBadge from './BotStatusBadge';

afterEach(() => cleanup());

describe('BotStatusBadge', () => {
  it('renders nothing when status is undefined', () => {
    const { container } = render(<BotStatusBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is pending', () => {
    const { container } = render(<BotStatusBadge status="pending" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders correct label for precheck_invited', () => {
    render(<BotStatusBadge status="precheck_invited" />);
    expect(screen.getByText('Pre-checking')).toBeTruthy();
  });

  it('renders correct label for main_joined', () => {
    render(<BotStatusBadge status="main_joined" />);
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('renders correct label for precheck_joined', () => {
    render(<BotStatusBadge status="precheck_joined" />);
    expect(screen.getByText('Link OK')).toBeTruthy();
  });

  it('renders correct label for precheck_failed', () => {
    render(<BotStatusBadge status="precheck_failed" />);
    expect(screen.getByText('Link Bad')).toBeTruthy();
  });

  it('renders correct label for main_failed', () => {
    render(<BotStatusBadge status="main_failed" />);
    expect(screen.getByText('Bot Failed')).toBeTruthy();
  });

  it('renders correct label for completed', () => {
    render(<BotStatusBadge status="completed" />);
    expect(screen.getByText('Recorded')).toBeTruthy();
  });

  it('tooltip includes error message when provided', () => {
    render(<BotStatusBadge status="main_failed" error="Connection refused" />);
    const badge = screen.getByTitle(/Connection refused/);
    expect(badge).toBeTruthy();
  });

  it('tooltip includes attempts count when provided', () => {
    render(<BotStatusBadge status="main_joined" attempts={3} />);
    const badge = screen.getByTitle(/3 attempts/);
    expect(badge).toBeTruthy();
  });

  it('tooltip uses error when both error and attempts are provided', () => {
    render(<BotStatusBadge status="main_joined" attempts={2} error="Timeout" />);
    const badge = screen.getByTitle(/Timeout/);
    expect(badge).toBeTruthy();
  });

  it('applies text-aurora-rose class for main_failed', () => {
    const { container } = render(<BotStatusBadge status="main_failed" />);
    const badge = container.querySelector('.text-aurora-rose');
    expect(badge).toBeTruthy();
  });

  it('applies text-aurora-emerald class for main_joined', () => {
    const { container } = render(<BotStatusBadge status="main_joined" />);
    const badge = container.querySelector('.text-aurora-emerald');
    expect(badge).toBeTruthy();
  });

  it('applies text-aurora-amber class for precheck_invited', () => {
    const { container } = render(<BotStatusBadge status="precheck_invited" />);
    const badge = container.querySelector('.text-aurora-amber');
    expect(badge).toBeTruthy();
  });
});
