import { Button } from './ui/button';

interface OnlineMeetingConsentBannerProps {
  checking: boolean;
  error: string;
  onGrant: () => void;
}

export function OnlineMeetingConsentBanner({ checking, error, onGrant }: OnlineMeetingConsentBannerProps) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">Microsoft Teams meeting permissions required</p>
          <p className="text-sm text-amber-800">
            Grant consent so we can create Microsoft Teams meetings on your behalf.
          </p>
        </div>
        <Button onClick={onGrant} disabled={checking} variant="secondary">
          {checking ? 'Checking…' : 'Grant consent'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-amber-900">{error}</p>}
    </div>
  );
}
