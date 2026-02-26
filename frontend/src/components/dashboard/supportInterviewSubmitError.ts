export const DUPLICATE_SUPPORT_SUBJECT_GUIDANCE =
  'A task with this interview subject already exists. Reply on the same email thread and request deletion from Tasks first. After deletion, submit this request again.';

export const DUPLICATE_SUPPORT_SUBJECT_TITLE = 'Duplicate interview support task';
export const DEFAULT_SUPPORT_SUBMIT_ERROR = 'Unable to send support request';

interface ToastPayload {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

interface SupportDuplicatePosthog {
  capture?: (event: string, properties?: Record<string, unknown>) => void;
}

interface HandleSupportInterviewSubmitErrorParams {
  responseStatus: number;
  backendMessage?: string | null;
  setSupportError: (message: string) => void;
  toast: (payload: ToastPayload) => unknown;
  posthog?: SupportDuplicatePosthog | null;
  candidateName?: string;
  interviewRound?: string;
  isLoopRound?: boolean;
}

export function handleSupportInterviewSubmitError({
  responseStatus,
  backendMessage,
  setSupportError,
  toast,
  posthog,
  candidateName,
  interviewRound,
  isLoopRound
}: HandleSupportInterviewSubmitErrorParams): string {
  const normalizedBackendMessage =
    typeof backendMessage === 'string' && backendMessage.trim().length > 0
      ? backendMessage.trim()
      : DEFAULT_SUPPORT_SUBMIT_ERROR;

  if (responseStatus === 409) {
    const duplicateMessage =
      normalizedBackendMessage === DEFAULT_SUPPORT_SUBMIT_ERROR
        ? DUPLICATE_SUPPORT_SUBJECT_GUIDANCE
        : normalizedBackendMessage;

    setSupportError(duplicateMessage);
    toast({
      title: DUPLICATE_SUPPORT_SUBJECT_TITLE,
      description: duplicateMessage,
      variant: 'destructive'
    });
    posthog?.capture?.('support_duplicate_blocked', {
      candidate: candidateName || '',
      round: interviewRound || '',
      is_loop_round: Boolean(isLoopRound)
    });

    return duplicateMessage;
  }

  setSupportError(normalizedBackendMessage);
  return normalizedBackendMessage;
}
