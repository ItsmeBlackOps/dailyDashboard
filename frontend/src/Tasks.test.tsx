import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Tasks from './Tasks';

describe('Tasks component', () => {
  it('renders tasks', () => {
    const tasks = [
      { assignedEmail: 'test@example.com', body: '<script>alert(1)</script>' },
    ];
    render(<Tasks tasks={tasks} />);
    const assigned = screen.getAllByText('test@example.com')[0];
    expect(assigned).toBeInTheDocument();
    // content should not contain the script tag after sanitization
    const pre = assigned.closest('tr')?.querySelector('pre');
    expect(pre?.innerHTML).not.toContain('<script>');
  });
});
