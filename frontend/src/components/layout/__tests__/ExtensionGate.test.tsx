/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { ExtensionGate } from '../ExtensionGate';
import { meetsMinVersion } from '@/lib/meetingDetector';

let mockStatus: 'checking' | 'installed' | 'missing' = 'missing';
let mockVersion = '';
const recheck = vi.fn();
vi.mock('@/hooks/useExtensionInstalled', () => ({
  useExtensionInstalled: () => ({ status: mockStatus, version: mockVersion, recheck }),
}));

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionGate />
    </MemoryRouter>,
  );
}

describe('ExtensionGate — hard block for technical roles', () => {
  beforeEach(() => {
    localStorage.setItem('role', 'user');
    mockStatus = 'missing';
    mockVersion = '';
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('blocks with a non-dismissible overlay when the extension is missing', () => {
    renderAt('/');
    const overlay = screen.getByRole('alertdialog');
    expect(overlay).toBeInTheDocument();
    expect(screen.getByText('Meeting Detector extension required')).toBeInTheDocument();
    expect(screen.getByText(/download the extension/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
    // No escape hatches: no Later / dismiss controls.
    expect(screen.queryByRole('button', { name: /later/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  it('blocks an OUTDATED install with update instructions', () => {
    mockStatus = 'installed';
    mockVersion = '1.6.0';
    renderAt('/');
    expect(
      screen.getByText('Update the Meeting Detector extension to continue'),
    ).toBeInTheDocument();
    expect(screen.getByText('1.6.0')).toBeInTheDocument();
  });

  it('renders nothing when a current version is installed', () => {
    mockStatus = 'installed';
    mockVersion = '1.7.1';
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while detection is still checking (no flash)', () => {
    mockStatus = 'checking';
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('never gates non-technical roles', () => {
    localStorage.setItem('role', 'recruiter');
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the setup page itself reachable', () => {
    const { container } = renderAt('/meeting-detector');
    expect(container).toBeEmptyDOMElement();
  });
});

describe('meetsMinVersion', () => {
  it('compares numeric segments', () => {
    expect(meetsMinVersion('1.7.0', '1.7.0')).toBe(true);
    expect(meetsMinVersion('1.7.1', '1.7.0')).toBe(true);
    expect(meetsMinVersion('1.10.0', '1.7.0')).toBe(true);
    expect(meetsMinVersion('2.0.0', '1.7.0')).toBe(true);
    expect(meetsMinVersion('1.6.9', '1.7.0')).toBe(false);
    expect(meetsMinVersion('0.9', '1.7.0')).toBe(false);
  });

  it('treats unknown/blank versions as failing', () => {
    expect(meetsMinVersion('', '1.7.0')).toBe(false);
    expect(meetsMinVersion(undefined, '1.7.0')).toBe(false);
    expect(meetsMinVersion('unknown', '1.7.0')).toBe(false);
  });
});
