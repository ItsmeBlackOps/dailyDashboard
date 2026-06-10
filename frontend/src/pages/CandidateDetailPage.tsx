import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, MapPin, Briefcase, Mail, Phone, Calendar, ExternalLink,
  Clock, Sparkles, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { canCreatePO } from '@/lib/roleAliases';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { statusColors, type CandidateStatus } from '@/components/profile-hub/mockData';
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
import FindJobsDialog from '@/components/jobs/FindJobsDialog';
import AttachmentZone, { type CandidateAttachment } from '@/components/candidates/AttachmentZone';
import AssignmentEmailModal from '@/components/candidates/AssignmentEmailModal';
import { CandidateTimeline } from '@/components/candidates/CandidateTimeline';

// ── Types ────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string; name: string; email: string; contact: string;
  technology: string; branch: string; recruiter: string; expert: string;
  status: string; poDate: string | null; receivedDate: string | null;
  updatedAt: string | null; resumeLink: string | null;
  statusHistory: { status: string; changedAt: string; changedBy: string }[];
  workflowStatus: string;
  // PRT Phase 2: server returns attachments[] in the marketing-track
  // projection. Absent for non-marketing readers (server-side strip).
  attachments?: CandidateAttachment[];
  // PRT Phase 3 — gating + status display for the assignment email.
  teamLead?: string | null;
  visaType?: string | null;
  ackEmail?: 'Sent' | 'Confirmed' | 'Pending' | null;
  ackEmailAt?: string | null;
  recruiterRaw?: string | null;
}

interface ForgeProfile {
  titles?: string[];
  keywords?: string[];
  years_min?: number;
  years_max?: number;
  baseline_skills?: string[];
  derivedFrom?: string;
  derivedAt?: string | null;
}

interface Interview {
  taskId: string;
  date: string | null; startTime: string | null; endTime: string | null;
  role: string; client: string; round: string; actualRound: string;
  vendor: string; status: string; assignedTo: string; assignedAt: string | null;
  recruiter: string; suggestions: string[]; receivedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatEmail(email: string) {
  if (!email) return '';
  if (!email.includes('@')) return email;
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function formatDate(d: string | Date | null, short = false) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-GB', short
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysAgo(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [findJobsOpen, setFindJobsOpen] = useState(false);
  // PRT Phase 3
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [forgeProfile, setForgeProfile] = useState<ForgeProfile | null>(null);
  const [forgeLoading, setForgeLoading] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const { toast } = useToast();

  const fetchCandidate = useCallback(() => {
    if (!id) return;
    authFetch(`${API_URL}/api/candidates/${id}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setCandidate(json.candidate);
        setInterviews(json.interviews || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, authFetch]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchCandidate();
  }, [id, fetchCandidate]);

  // Fetch cached forge profile
  useEffect(() => {
    if (!id) return;
    setForgeLoading(true);
    authFetch(`${API_URL}/api/candidates/${id}/forge-profile`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setForgeProfile(json.forgeProfile || null);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setForgeLoading(false));
  }, [id, authFetch]);

  async function handleDeriveProfile() {
    if (!id || deriving) return;
    setDeriving(true);
    try {
      const r = await authFetch(`${API_URL}/api/candidates/${id}/derive-profile`, { method: 'POST' });
      const json = await r.json();
      if (!json.success) throw new Error(json.error || 'Derivation failed');
      setForgeProfile(json.forgeProfile || null);
      toast({ title: 'Search profile updated', description: 'Re-derived from current resume.' });
    } catch (e: any) {
      toast({ title: 'Derivation failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setDeriving(false);
    }
  }

  return (
    <>
      <div className="px-4 md:px-6 py-4 space-y-5 max-w-3xl mx-auto">
        {/* Back */}
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive p-4 rounded-md border border-destructive/30">
            Failed to load candidate: {error}
          </div>
        )}

        {candidate && (
          <>
            {/* ── Profile card ── */}
            <Card className="overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold shrink-0">
                      {candidate.name.charAt(0)}
                    </div>
                    <div>
                      <h1 className="text-lg font-bold leading-tight">{candidate.name}</h1>
                      <p className="text-sm text-muted-foreground mt-0.5">{candidate.technology || 'Technology not set'}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColors[(candidate.status as CandidateStatus)] || ''}`}>
                          {candidate.status}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5">{candidate.branch}</Badge>
                        {candidate.workflowStatus && (
                          <Badge variant="secondary" className="text-[10px] px-1.5">{candidate.workflowStatus}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {candidate.status === 'Placement Offer' && canCreatePO() && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => {
                          setPoPrefill({
                            taskId: '',
                            candidateId: candidate.id,
                            candidateName: candidate.name,
                            emailId: candidate.email || '',
                            position: candidate.technology || '',
                            recruiter: candidate.recruiter || '',
                            branch: candidate.branch || '',
                          });
                          setPoSheetOpen(true);
                        }}
                      >
                        + Create PO Draft
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => setFindJobsOpen(true)}
                    >
                      <Briefcase className="h-3.5 w-3.5" /> Find Jobs
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => navigate(`/candidate/${id}/jobs`)}
                    >
                      <Briefcase className="h-3.5 w-3.5" /> Matched Jobs
                    </Button>
                    {candidate.resumeLink && (
                      <a href={candidate.resumeLink} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="text-xs gap-1.5">
                          <ExternalLink className="h-3.5 w-3.5" /> Resume
                        </Button>
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t">
                  {[
                    { icon: Mail,      label: 'Email',     value: candidate.email },
                    { icon: Phone,     label: 'Contact',   value: candidate.contact || null },
                    { icon: User,      label: 'Recruiter', value: candidate.recruiter ? formatEmail(candidate.recruiter) : null },
                    { icon: Briefcase, label: 'Expert',    value: candidate.expert ? formatEmail(candidate.expert) : null },
                    { icon: MapPin,    label: 'Branch',    value: candidate.branch },
                    { icon: Calendar,  label: 'Updated',
                      value: candidate.updatedAt
                        ? `${formatDate(candidate.updatedAt)} (${daysAgo(candidate.updatedAt)}d ago)`
                        : null },
                  ].filter(f => f.value).map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                        <div className="text-xs font-medium break-all">{value}</div>
                      </div>
                    </div>
                  ))}
                  {candidate.poDate && (
                    <div className="flex items-start gap-2">
                      <Calendar className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">PO Date</div>
                        <div className="text-xs font-medium text-violet-400">{formatDate(candidate.poDate)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Search Profile (forgeProfile) ── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Search Profile
                  <span className="text-xs font-normal text-muted-foreground ml-auto">
                    {forgeProfile?.derivedAt
                      ? `derived ${formatDate(forgeProfile.derivedAt)}`
                      : 'not derived'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-5 pt-1">
                {forgeLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : forgeProfile ? (
                  <div className="space-y-3">
                    {forgeProfile.titles?.length ? (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Titles</div>
                        <div className="flex flex-wrap gap-1.5">
                          {forgeProfile.titles.map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {forgeProfile.keywords?.length ? (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Keywords</div>
                        <div className="flex flex-wrap gap-1.5">
                          {forgeProfile.keywords.map((k) => (
                            <Badge key={k} variant="outline" className="text-[10px] font-normal">{k}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Years of Experience</div>
                        <div className="text-xs font-medium">
                          {forgeProfile.years_min ?? '?'}–{forgeProfile.years_max ?? '?'} yrs
                        </div>
                      </div>
                      {forgeProfile.baseline_skills?.length ? (
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Baseline Skills</div>
                          <div className="text-xs font-medium">{forgeProfile.baseline_skills.length} tracked</div>
                        </div>
                      ) : null}
                    </div>
                    <div className="pt-2 border-t flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={handleDeriveProfile}
                        disabled={deriving || !candidate?.resumeLink}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${deriving ? 'animate-spin' : ''}`} />
                        {deriving ? 'Re-deriving…' : 'Re-derive from Resume'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <p className="text-xs text-muted-foreground">No search profile yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={handleDeriveProfile}
                      disabled={deriving || !candidate?.resumeLink}
                    >
                      <Sparkles className={`h-3.5 w-3.5 ${deriving ? 'animate-pulse' : ''}`} />
                      {deriving ? 'Deriving…' : 'Derive Now'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── PRT Phase 3: Assignment Email ── */}
            {candidate && (() => {
              const attachmentsCount = candidate.attachments?.length ?? 0;
              const hasRecruiter = Boolean(candidate.recruiterRaw || candidate.recruiter);
              const hasTeamLead = Boolean(candidate.teamLead);
              const canSendAssignment = hasRecruiter && hasTeamLead && attachmentsCount > 0;
              const ackSent = candidate.ackEmail === 'Sent';
              return (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Mail className="h-4 w-4" /> Assignment Email
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-5 pt-1 flex flex-col items-start gap-2">
                    <Button
                      type="button"
                      onClick={() => setAssignmentModalOpen(true)}
                      disabled={!canSendAssignment}
                    >
                      <Mail className="h-4 w-4 mr-1.5" />
                      {ackSent ? 'Email Sent — Resend' : 'Send Assignment Email'}
                    </Button>
                    {!canSendAssignment && (
                      <p className="text-xs text-muted-foreground">
                        Requires recruiter, team lead, and at least one attachment.
                      </p>
                    )}
                    {ackSent && candidate.ackEmailAt && (
                      <p className="text-xs text-emerald-700">
                        Last sent {new Date(candidate.ackEmailAt).toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* ── PRT Phase 2: Attachments ── */}
            {candidate && (
              <AttachmentZone
                candidateId={candidate.id}
                attachments={candidate.attachments ?? []}
                resumeLink={candidate.resumeLink}
                onChange={fetchCandidate}
              />
            )}

            {/* PRT Phase 3 — modal lives outside the cards so it floats above */}
            {candidate && (
              <AssignmentEmailModal
                open={assignmentModalOpen}
                onOpenChange={setAssignmentModalOpen}
                candidateId={candidate.id}
                candidateName={candidate.name}
                technology={candidate.technology}
                visaType={candidate.visaType}
                recruiterEmail={candidate.recruiterRaw || null}
                teamLeadEmail={candidate.teamLead || null}
                attachments={candidate.attachments ?? []}
                onSent={fetchCandidate}
              />
            )}

            {/* ── Unified Activity Timeline ── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Full Activity Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-5 pt-1">
                {id && <CandidateTimeline candidateId={id} />}
              </CardContent>
            </Card>

            {/* ── Summary counts ── */}
            {interviews.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Interviews', value: interviews.length, color: 'text-foreground' },
                  { label: 'Completed', value: interviews.filter(i => ['completed','done','selected'].includes((i.status||'').toLowerCase())).length, color: 'text-emerald-600' },
                  { label: 'Status Changes', value: candidate.statusHistory.length, color: 'text-violet-600' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <CardContent className="p-3 text-center">
                      <div className={`text-xl font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <TaskSheet
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onCreatePO={(prefill) => {
          setPoPrefill(prefill);
          setPoSheetOpen(true);
        }}
      />
      <PODraftSheet
        open={poSheetOpen}
        onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
        prefill={poPrefill}
      />
      {candidate && (
        <FindJobsDialog
          open={findJobsOpen}
          onOpenChange={setFindJobsOpen}
          candidateId={candidate.id}
          candidateName={candidate.name}
        />
      )}
    </>
  );
}
