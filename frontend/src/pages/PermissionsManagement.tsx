import { useEffect, useState, useMemo } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, RefreshCw, Search, AlertCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PERMISSION_LABELS, PERMISSION_CATEGORIES } from '@/config/permissions';

interface RolePermission {
    role: string;
    permissions: string[];
    updatedAt: string;
    updatedBy: string;
}

interface PermissionCategory {
    [key: string]: string[];
}

const PERMISSION_LABELS: Record<string, string> = {
    view_dashboard: 'View Dashboard',
    view_tasks: 'View Tasks',
    view_branch_candidates: 'View Branch Candidates',
    view_resume_understanding: 'View Resume Understanding',
    view_admin_alerts: 'View Admin Alerts',
    view_user_management: 'View User Management',
    view_reports: 'View Reports',
    view_report_assistant: 'View Report Assistant',
    view_completed_tab: 'View Completed Tab',
    filter_resume_events_by_expert: 'Filter Resume Events by Expert',
    update_resume_status_any: 'Update Any Resume Status',
    update_resume_status_own: 'Update Own Resume Status',
    view_expert_stats: 'View Expert Stats',
    view_recruiter_stats: 'View Recruiter Stats',
    can_see_branch_breakdown: 'See Branch Breakdown',
    format_notification_as_lead: 'Format Notification as Lead',
    format_notification_as_manager: 'Format Notification as Manager',
    view_complaints: 'View Complaints',
    create_complaints: 'Create Complaints',
    manage_users: 'Manage Users',
    change_password: 'Change Password',
    view_whats_new: 'View Whats New',
    delete_tasks: 'Delete Tasks',
    clone_support_task: 'Clone Support Task',
    request_mock: 'Request Mock',
    generate_thanks_mail: 'Generate Thanks Mail',
    manage_meetings: 'Manage Meetings',
    view_meeting_consent_banner: 'View Meeting Consent Banner',
    send_support_request: 'Send Support Request',
    edit_candidate: 'Edit Candidate',
    edit_basic_fields: 'Edit Basic Fields',
    change_recruiter: 'Change Recruiter',
    change_contact: 'Change Contact',
    change_expert: 'Change Expert',
    create_candidate: 'Create Candidate',
    view_create_button: 'View Create Button',
    start_driver_tour: 'Start Driver Tour',
    use_received_date_filter: 'Use Received Date Filter',
    can_see_all_team: 'See All Team'
};

export default function PermissionsManagement() {
    const { user, authFetch } = useAuth();
    const { toast } = useToast();

    const [roles, setRoles] = useState<RolePermission[]>([]);
    const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
    const [categories, setCategories] = useState<PermissionCategory>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [changes, setChanges] = useState<Record<string, string[]>>({});
    const [error, setError] = useState('');

    // Check if user is admin
    const isAdmin = useMemo(() => {
        return user?.role?.toLowerCase() === 'admin';
    }, [user]);

    useEffect(() => {
        if (!isAdmin) {
            setError('Access denied. Only administrators can manage permissions.');
            setLoading(false);
            return;
        }
        fetchData();
    }, [isAdmin]);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const [rolesRes, permsRes] = await Promise.all([
                authFetch(`${API_URL}/api/permissions/roles`),
                authFetch(`${API_URL}/api/permissions/available`)
            ]);

            const rolesData = await rolesRes.json();
            const permsData = await permsRes.json();

            if (rolesData.success) {
                setRoles(rolesData.data);
            }

            if (permsData.success) {
                setAvailablePermissions(permsData.data.permissions);
                setCategories(permsData.data.categories);
            }
        } catch (err) {
            console.error('Failed to fetch permissions:', err);
            setError('Failed to load permissions data');
            toast({
                title: 'Error',
                description: 'Failed to load permissions',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = (role: string, permission: string) => {
        setChanges(prev => {
            const currentPerms = prev[role] || roles.find(r => r.role === role)?.permissions || [];
            const newPerms = currentPerms.includes(permission)
                ? currentPerms.filter(p => p !== permission)
                : [...currentPerms, permission];

            return {
                ...prev,
                [role]: newPerms
            };
        });
    };

    const hasPermission = (role: string, permission: string): boolean => {
        const roleData = changes[role] || roles.find(r => r.role === role)?.permissions || [];
        return roleData.includes(permission);
    };

    const hasChanges = useMemo(() => {
        return Object.keys(changes).length > 0;
    }, [changes]);

    const saveChanges = async () => {
        setSaving(true);
        try {
            const updatePromises = Object.entries(changes).map(async ([role, permissions]) => {
                const res = await authFetch(`${API_URL}/api/permissions/roles/${role}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permissions })
                });
                return res.json();
            });

            const results = await Promise.all(updatePromises);

            const allSuccess = results.every(r => r.success);

            if (allSuccess) {
                toast({
                    title: 'Success',
                    description: `Updated permissions for ${Object.keys(changes).length} role(s)`
                });
                setChanges({});
                await fetchData();
            } else {
                throw new Error('Some updates failed');
            }
        } catch (err) {
            console.error('Failed to save permissions:', err);
            toast({
                title: 'Error',
                description: 'Failed to save permissions',
                variant: 'destructive'
            });
        } finally {
            setSaving(false);
        }
    };

    const discardChanges = () => {
        setChanges({});
        toast({
            title: 'Changes Discarded',
            description: 'All unsaved changes have been discarded'
        });
    };

    const filteredPermissions = useMemo(() => {
        let perms = availablePermissions;

        if (selectedCategory !== 'all' && categories[selectedCategory]) {
            const categoryData = categories[selectedCategory];
            // Handle both array format and object format with permissions array
            perms = Array.isArray(categoryData) ? categoryData :
                (categoryData.permissions || categoryData);
        }

        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            perms = perms.filter(p =>
                p.toLowerCase().includes(search) ||
                PERMISSION_LABELS[p]?.toLowerCase().includes(search)
            );
        }

        return perms;
    }, [availablePermissions, selectedCategory, searchTerm, categories]);

    if (!isAdmin) {
        return (
            <DashboardLayout>
                <div className="container mx-auto p-6">
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            Access denied. Only administrators can manage permissions.
                        </AlertDescription>
                    </Alert>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="container mx-auto p-6 space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold">Permissions Management</h1>
                        <p className="text-muted-foreground">
                            Normalized RBAC: 30 Capabilities (resource:action) + 3 Scopes (own/team/any)
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={fetchData}
                            disabled={loading}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        {hasChanges && (
                            <>
                                <Button variant="ghost" onClick={discardChanges}>
                                    Discard
                                </Button>
                                <Button onClick={saveChanges} disabled={saving}>
                                    {saving ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4 mr-2" />
                                            Save Changes
                                        </>
                                    )}
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {hasChanges && (
                    <Alert>
                        <AlertDescription>
                            You have unsaved changes for {Object.keys(changes).length} role(s)
                        </AlertDescription>
                    </Alert>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle>Filter & Search</CardTitle>
                        <CardDescription>Filter permissions by category or search</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <div className="relative">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search permissions..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-8"
                                    />
                                </div>
                            </div>
                            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Categories</SelectItem>
                                    {Object.entries(PERMISSION_CATEGORIES).map(([key, data]) => (
                                        <SelectItem key={key} value={key}>
                                            {typeof data === 'object' && 'label' in data ? data.label : key.charAt(0).toUpperCase() + key.slice(1)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Permission Matrix</CardTitle>
                        <CardDescription>
                            Toggle permissions for each role
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-3 font-semibold sticky left-0 bg-background z-10">
                                                Permission
                                            </th>
                                            {roles.map(role => (
                                                <th key={role.role} className="text-center p-3 font-semibold min-w-[100px]">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="capitalize">{role.role}</span>
                                                        {changes[role.role] && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                Modified
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredPermissions.map(permission => (
                                            <tr key={permission} className="border-b hover:bg-muted/50">
                                                <td className="p-3 font-medium sticky left-0 bg-background">
                                                    <div className="flex flex-col">
                                                        <span>{PERMISSION_LABELS[permission] || permission}</span>
                                                        <span className="text-xs text-muted-foreground">{permission}</span>
                                                    </div>
                                                </td>
                                                {roles.map(role => (
                                                    <td key={`${role.role}-${permission}`} className="p-3 text-center">
                                                        <div className="flex justify-center">
                                                            <Switch
                                                                checked={hasPermission(role.role, permission)}
                                                                onCheckedChange={() => togglePermission(role.role, permission)}
                                                            />
                                                        </div>
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                        {filteredPermissions.length === 0 && (
                                            <tr>
                                                <td colSpan={roles.length + 1} className="p-8 text-center text-muted-foreground">
                                                    No permissions found matching your search
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Role Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {roles.map(role => {
                                const current = changes[role.role] || role.permissions;
                                return (
                                    <div key={role.role} className="border rounded-lg p-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-semibold capitalize">{role.role}</h3>
                                            {changes[role.role] && (
                                                <Badge variant="secondary">Modified</Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {current.length} permission{current.length !== 1 ? 's' : ''}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Last updated: {new Date(role.updatedAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
