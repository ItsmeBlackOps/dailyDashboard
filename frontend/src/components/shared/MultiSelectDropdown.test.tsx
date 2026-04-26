/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import MultiSelectDropdown from './MultiSelectDropdown';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OPTIONS = [
  { value: 'alpha', label: 'Alpha', sublabel: 'Group A' },
  { value: 'beta',  label: 'Beta',  sublabel: 'Group B' },
  { value: 'gamma', label: 'Gamma', sublabel: 'Group C' },
];

describe('MultiSelectDropdown', () => {
  it('renders trigger with label', () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    expect(screen.getByText('Branches')).toBeTruthy();
  });

  it('shows count badge when items are selected', () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={['alpha', 'beta']} onChange={() => {}} />
    );
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('does not show numeric badge when nothing selected', () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('opens popover and shows all options on click', async () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(screen.getByText('Gamma')).toBeTruthy();
    });
  });

  it('shows sublabels after opening', async () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText('Group A')).toBeTruthy();
    });
  });

  it('search filters options by label (case-insensitive)', async () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('Search branches...');
    fireEvent.change(input, { target: { value: 'alph' } });
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
      expect(screen.queryByText('Beta')).toBeNull();
    });
  });

  it('search filters options by sublabel (case-insensitive)', async () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('Search branches...');
    fireEvent.change(input, { target: { value: 'group b' } });
    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(screen.queryByText('Alpha')).toBeNull();
    });
  });

  it('checking an option calls onChange with correct array', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button'));
    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('unchecking an option removes it from selection', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={['alpha', 'beta']} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button'));
    const checkboxes = await screen.findAllByRole('checkbox');
    // alpha is index 0 and is checked
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });

  it('"Select all" selects all filtered options', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Select all');
    fireEvent.click(screen.getByText('Select all'));
    expect(onChange).toHaveBeenCalledWith(['alpha', 'beta', 'gamma']);
  });

  it('"Clear" calls onChange with empty array', async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={['alpha']} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Clear');
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('empty filtered list shows "No matches"', async () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('Search branches...');
    fireEvent.change(input, { target: { value: 'zzznomatch' } });
    await waitFor(() => {
      expect(screen.getByText('No matches')).toBeTruthy();
    });
  });

  it('disabled state prevents trigger interaction', () => {
    render(
      <MultiSelectDropdown label="Branches" options={OPTIONS} selected={[]} onChange={() => {}} disabled />
    );
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
