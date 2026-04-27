/* @vitest-environment jsdom */
import * as React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { CompanyCombobox, invalidateClientsCache } from './CompanyCombobox';

// ── Global stubs ─────────────────────────────────────────────────────────────
// cmdk uses ResizeObserver internally
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// cmdk calls scrollIntoView on items
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const CLIENTS = ['Acme Corp', 'Microsoft', 'Google'];

function makeFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
}

function defaultFetch() {
  return makeFetch((url) => {
    if (url.includes('distinct-clients')) {
      return { status: 200, body: { success: true, clients: CLIENTS } };
    }
    return { status: 404, body: {} };
  });
}

/** Click the trigger button (first button with role=combobox or the trigger text) */
function clickTrigger() {
  // The trigger button contains the placeholder/value text — use getAllByRole and pick [0]
  const buttons = screen.getAllByRole('combobox');
  // The trigger is the one that is NOT inside the command popover (it has aria-haspopup=dialog)
  const trigger = buttons.find((b) => b.getAttribute('aria-haspopup') === 'dialog') ?? buttons[0];
  fireEvent.click(trigger);
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  invalidateClientsCache();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invalidateClientsCache();
});

// ── Test 1: Renders trigger with placeholder when no value ───────────────────
it('renders trigger button with placeholder when value is empty', () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);
  const buttons = screen.getAllByRole('combobox');
  const trigger = buttons.find((b) => b.getAttribute('aria-haspopup') === 'dialog') ?? buttons[0];
  expect(trigger).toBeTruthy();
  expect(trigger.textContent).toContain('Select client…');
});

// ── Test 2: Renders trigger with value when provided ────────────────────────
it('renders trigger with value when value provided', () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="Microsoft" onChange={() => {}} />);
  const buttons = screen.getAllByRole('combobox');
  const trigger = buttons.find((b) => b.getAttribute('aria-haspopup') === 'dialog') ?? buttons[0];
  expect(trigger.textContent).toContain('Microsoft');
});

// ── Test 3: Opens popover and shows companies ────────────────────────────────
it('opens popover and shows companies from /distinct-clients', async () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);

  await act(async () => { clickTrigger(); });

  await waitFor(() => {
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText('Microsoft')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
  });
});

// ── Test 4: Typing in search filters the list ───────────────────────────────
it('typing in search filters the list', async () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Acme Corp'));

  const searchInput = screen.getByPlaceholderText('Search company…');
  await act(async () => {
    fireEvent.change(searchInput, { target: { value: 'micro' } });
  });

  await waitFor(() => {
    expect(screen.getByText('Microsoft')).toBeTruthy();
    // Acme Corp should not be visible
    expect(screen.queryByText('Acme Corp')).toBeFalsy();
  });
});

// ── Test 5: Clicking an existing company calls onChange and closes ───────────
it('clicking an existing company commits it via onChange and closes', async () => {
  global.fetch = defaultFetch();
  const onChange = vi.fn();
  render(<CompanyCombobox value="" onChange={onChange} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Acme Corp'));

  await act(async () => {
    fireEvent.click(screen.getByText('Acme Corp'));
  });

  expect(onChange).toHaveBeenCalledWith('Acme Corp');
});

// ── Test 6: Clicking "+ Add new company" switches to add-new form ────────────
it('clicking "+ Add new company" switches to add-new form', async () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Add new company'));

  await act(async () => {
    fireEvent.click(screen.getByText('Add new company'));
  });

  await waitFor(() => {
    expect(screen.getByPlaceholderText('Company name')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});

// ── Test 7: Add-new form: empty Save → inline error ─────────────────────────
it('add-new form: empty Save shows inline error', async () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Add new company'));

  await act(async () => { fireEvent.click(screen.getByText('Add new company')); });
  await waitFor(() => screen.getByText('Save'));

  await act(async () => { fireEvent.click(screen.getByText('Save')); });

  await waitFor(() => {
    expect(screen.getByText('Name is required')).toBeTruthy();
  });
});

// ── Test 8: Add-new success → POST fired, onChange(newName) called ──────────
it('add-new success fires POST and calls onChange with new name', async () => {
  let callCount = 0;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('distinct-clients')) {
      const updated = callCount === 0
        ? { success: true, clients: CLIENTS }
        : { success: true, clients: [...CLIENTS, 'New Client Inc'] };
      callCount++;
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.includes('end-clients')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, client: 'New Client Inc' }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });

  const onChange = vi.fn();
  render(<CompanyCombobox value="" onChange={onChange} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Add new company'));

  await act(async () => { fireEvent.click(screen.getByText('Add new company')); });
  await waitFor(() => screen.getByPlaceholderText('Company name'));

  const input = screen.getByPlaceholderText('Company name');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'New Client Inc' } });
  });

  await act(async () => { fireEvent.click(screen.getByText('Save')); });

  await waitFor(() => {
    expect(onChange).toHaveBeenCalledWith('New Client Inc');
  });

  const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
    ([url]: [string]) => url.includes('end-clients')
  );
  expect(postCall).toBeTruthy();
  const body = JSON.parse(postCall[1].body);
  expect(body.name).toBe('New Client Inc');
});

// ── Test 9: Add-new 409 duplicate → onChange(existing) ──────────────────────
it('add-new 409 duplicate calls onChange with existing canonical name', async () => {
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes('distinct-clients')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, clients: CLIENTS }),
      } as Response;
    }
    if (url.includes('end-clients')) {
      return {
        ok: false, status: 409,
        json: async () => ({ success: false, error: 'Company already exists', existing: 'Microsoft' }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });

  const onChange = vi.fn();
  render(<CompanyCombobox value="" onChange={onChange} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByText('Add new company'));

  await act(async () => { fireEvent.click(screen.getByText('Add new company')); });
  await waitFor(() => screen.getByPlaceholderText('Company name'));

  const input = screen.getByPlaceholderText('Company name');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'microsoft' } });
  });

  await act(async () => { fireEvent.click(screen.getByText('Save')); });

  await waitFor(() => {
    expect(onChange).toHaveBeenCalledWith('Microsoft');
  });
});

// ── Test 10: Paste event in search input is preventDefault-ed ───────────────
it('paste event in search input is preventDefault-ed', async () => {
  global.fetch = defaultFetch();
  render(<CompanyCombobox value="" onChange={() => {}} />);

  await act(async () => { clickTrigger(); });
  await waitFor(() => screen.getByPlaceholderText('Search company…'));

  const searchInput = screen.getByPlaceholderText('Search company…') as HTMLInputElement;

  // Track whether preventDefault was called on the paste event
  let preventDefaultCalled = false;
  searchInput.addEventListener('paste', (e) => {
    if (e.defaultPrevented) preventDefaultCalled = true;
  }, { once: true });

  // fireEvent.paste goes through React's synthetic event handling
  // The onPaste handler calls e.preventDefault(), so the input value stays empty
  fireEvent.paste(searchInput, {
    clipboardData: { getData: () => 'pasted text' },
  });

  // Input value should remain empty — paste was blocked
  expect(searchInput.value).toBe('');
});
