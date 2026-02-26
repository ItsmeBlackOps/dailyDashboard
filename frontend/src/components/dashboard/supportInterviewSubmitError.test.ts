import { describe, expect, it, vi } from 'vitest';
import {
  DUPLICATE_SUPPORT_SUBJECT_GUIDANCE,
  DUPLICATE_SUPPORT_SUBJECT_TITLE,
  handleSupportInterviewSubmitError
} from './supportInterviewSubmitError';

describe('handleSupportInterviewSubmitError', () => {
  it('shows destructive toast and tracks analytics on 409 duplicate conflict', () => {
    const setSupportError = vi.fn();
    const toast = vi.fn();
    const capture = vi.fn();
    const backendMessage =
      'A task with this interview subject already exists. Reply on the same email thread and request deletion from Tasks first. After deletion, submit this request again.';

    const result = handleSupportInterviewSubmitError({
      responseStatus: 409,
      backendMessage,
      setSupportError,
      toast,
      posthog: { capture },
      candidateName: 'John Doe',
      interviewRound: 'Loop Round',
      isLoopRound: true
    });

    expect(result).toBe(backendMessage);
    expect(setSupportError).toHaveBeenCalledWith(backendMessage);
    expect(toast).toHaveBeenCalledWith({
      title: DUPLICATE_SUPPORT_SUBJECT_TITLE,
      description: backendMessage,
      variant: 'destructive'
    });
    expect(capture).toHaveBeenCalledWith('support_duplicate_blocked', {
      candidate: 'John Doe',
      round: 'Loop Round',
      is_loop_round: true
    });
  });

  it('falls back to strict duplicate guidance when backend 409 message is missing', () => {
    const setSupportError = vi.fn();
    const toast = vi.fn();

    const result = handleSupportInterviewSubmitError({
      responseStatus: 409,
      backendMessage: null,
      setSupportError,
      toast
    });

    expect(result).toBe(DUPLICATE_SUPPORT_SUBJECT_GUIDANCE);
    expect(setSupportError).toHaveBeenCalledWith(DUPLICATE_SUPPORT_SUBJECT_GUIDANCE);
    expect(toast).toHaveBeenCalledWith({
      title: DUPLICATE_SUPPORT_SUBJECT_TITLE,
      description: DUPLICATE_SUPPORT_SUBJECT_GUIDANCE,
      variant: 'destructive'
    });
  });

  it('keeps non-409 behavior inline without popup', () => {
    const setSupportError = vi.fn();
    const toast = vi.fn();
    const capture = vi.fn();

    const result = handleSupportInterviewSubmitError({
      responseStatus: 400,
      backendMessage: 'Interview date and time is required',
      setSupportError,
      toast,
      posthog: { capture }
    });

    expect(result).toBe('Interview date and time is required');
    expect(setSupportError).toHaveBeenCalledWith('Interview date and time is required');
    expect(toast).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
