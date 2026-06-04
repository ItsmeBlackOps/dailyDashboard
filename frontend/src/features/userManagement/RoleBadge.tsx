// A themed role pill. Pure presentational wrapper over the existing
// Badge primitive — label + variant come from the tested roleLabels map,
// so no colours are introduced here.

import { Badge } from '@/components/ui/badge';
import { roleLabel, roleBadgeVariant } from './roleLabels';

export function RoleBadge({ role }: { role: string }) {
  return <Badge variant={roleBadgeVariant(role)}>{roleLabel(role)}</Badge>;
}
