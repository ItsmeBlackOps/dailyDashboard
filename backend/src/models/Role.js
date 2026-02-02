import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const PERMISSIONS = {
    // Views (Sidebar Access)
    VIEW_DASHBOARD: 'view_dashboard',
    VIEW_TASKS: 'view_tasks',
    VIEW_BRANCH_CANDIDATES: 'view_branch_candidates',
    VIEW_RESUME_UNDERSTANDING: 'view_resume_understanding',
    VIEW_ADMIN_ALERTS: 'view_admin_alerts',
    VIEW_USER_MANAGEMENT: 'view_user_management',
    VIEW_REPORTS: 'view_reports',
    VIEW_REPORT_ASSISTANT: 'view_report_assistant',

    // Resume Understanding Specifics
    VIEW_COMPLETED_TAB: 'view_completed_tab',
    FILTER_RESUME_EVENTS_BY_EXPERT: 'filter_resume_events_by_expert',
    UPDATE_RESUME_STATUS_ANY: 'update_resume_status_any',
    UPDATE_RESUME_STATUS_OWN: 'update_resume_status_own',

    // Dashboard Widgets
    VIEW_EXPERT_STATS: 'view_expert_stats',
    VIEW_RECRUITER_STATS: 'view_recruiter_stats',
    CAN_SEE_BRANCH_BREAKDOWN: 'can_see_branch_breakdown',

    // Notification / Discussion
    FORMAT_NOTIFICATION_AS_LEAD: 'format_notification_as_lead',
    FORMAT_NOTIFICATION_AS_MANAGER: 'format_notification_as_manager',
    VIEW_COMPLAINTS: 'view_complaints',
    CREATE_COMPLAINTS: 'create_complaints',

    // Actions (Global)
    MANAGE_USERS: 'manage_users',
    CHANGE_PASSWORD: 'change_password',
    VIEW_WHATS_NEW: 'view_whats_new',

    // Tasks Today
    DELETE_TASKS: 'delete_tasks',
    CLONE_SUPPORT_TASK: 'clone_support_task',
    REQUEST_MOCK: 'request_mock',
    GENERATE_THANKS_MAIL: 'generate_thanks_mail',
    MANAGE_MEETINGS: 'manage_meetings',
    VIEW_MEETING_CONSENT_BANNER: 'view_meeting_consent_banner',
    SEND_SUPPORT_REQUEST: 'send_support_request',

    // Branch Candidates
    EDIT_CANDIDATE: 'edit_candidate',
    EDIT_BASIC_FIELDS: 'edit_basic_fields',
    CHANGE_RECRUITER: 'change_recruiter',
    CHANGE_CONTACT: 'change_contact',
    CHANGE_EXPERT: 'change_expert',
    CREATE_CANDIDATE: 'create_candidate',
    VIEW_CREATE_BUTTON: 'view_create_button',
    START_DRIVER_TOUR: 'start_driver_tour',

    // Dashboard
    USE_RECEIVED_DATE_FILTER: 'use_received_date_filter',

    // Legacy / Others from frontend config
    CAN_SEE_ALL_TEAM: 'can_see_all_team',
};

const DEFAULT_ROLES = {
    admin: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_ADMIN_ALERTS, PERMISSIONS.VIEW_USER_MANAGEMENT,
            PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_REPORT_ASSISTANT, PERMISSIONS.VIEW_COMPLETED_TAB,
            PERMISSIONS.UPDATE_RESUME_STATUS_ANY, PERMISSIONS.MANAGE_USERS, PERMISSIONS.CHANGE_PASSWORD,
            PERMISSIONS.VIEW_WHATS_NEW, PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
            PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.EDIT_BASIC_FIELDS, PERMISSIONS.CHANGE_RECRUITER,
            PERMISSIONS.CHANGE_CONTACT, PERMISSIONS.CHANGE_EXPERT, PERMISSIONS.CLONE_SUPPORT_TASK,
            PERMISSIONS.SEND_SUPPORT_REQUEST, PERMISSIONS.USE_RECEIVED_DATE_FILTER, PERMISSIONS.VIEW_EXPERT_STATS,
            PERMISSIONS.VIEW_RECRUITER_STATS, PERMISSIONS.CAN_SEE_BRANCH_BREAKDOWN, PERMISSIONS.VIEW_COMPLAINTS,
            PERMISSIONS.CREATE_COMPLAINTS
        ],
        scopes: { candidates: 'all', tasks: 'all' }
    },
    manager: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_COMPLETED_TAB,
            PERMISSIONS.MANAGE_USERS, PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW,
            PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.EDIT_BASIC_FIELDS,
            PERMISSIONS.CREATE_CANDIDATE, PERMISSIONS.VIEW_CREATE_BUTTON, PERMISSIONS.USE_RECEIVED_DATE_FILTER,
            PERMISSIONS.VIEW_MEETING_CONSENT_BANNER, PERMISSIONS.FORMAT_NOTIFICATION_AS_MANAGER,
            PERMISSIONS.VIEW_COMPLAINTS, PERMISSIONS.CREATE_COMPLAINTS
        ],
        scopes: { candidates: 'all', tasks: 'all' }
    },
    mm: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_REPORTS,
            PERMISSIONS.VIEW_REPORT_ASSISTANT, PERMISSIONS.VIEW_COMPLETED_TAB, PERMISSIONS.MANAGE_USERS,
            PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW, PERMISSIONS.CLONE_SUPPORT_TASK,
            PERMISSIONS.REQUEST_MOCK, PERMISSIONS.GENERATE_THANKS_MAIL, PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.SEND_SUPPORT_REQUEST, PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.EDIT_BASIC_FIELDS,
            PERMISSIONS.CHANGE_RECRUITER, PERMISSIONS.CHANGE_CONTACT, PERMISSIONS.CREATE_CANDIDATE,
            PERMISSIONS.VIEW_CREATE_BUTTON, PERMISSIONS.START_DRIVER_TOUR, PERMISSIONS.USE_RECEIVED_DATE_FILTER
        ],
        scopes: { candidates: 'branch', tasks: 'team' }
    },
    mam: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_REPORTS,
            PERMISSIONS.VIEW_REPORT_ASSISTANT, PERMISSIONS.VIEW_COMPLETED_TAB, PERMISSIONS.MANAGE_USERS,
            PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW, PERMISSIONS.REQUEST_MOCK,
            PERMISSIONS.GENERATE_THANKS_MAIL, PERMISSIONS.SEND_SUPPORT_REQUEST, PERMISSIONS.EDIT_CANDIDATE,
            PERMISSIONS.EDIT_BASIC_FIELDS, PERMISSIONS.CHANGE_RECRUITER, PERMISSIONS.CHANGE_CONTACT,
            PERMISSIONS.START_DRIVER_TOUR, PERMISSIONS.USE_RECEIVED_DATE_FILTER
        ],
        scopes: { candidates: 'hierarchy', tasks: 'team' }
    },
    mlead: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_COMPLETED_TAB,
            PERMISSIONS.MANAGE_USERS, PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW,
            PERMISSIONS.CLONE_SUPPORT_TASK, PERMISSIONS.REQUEST_MOCK, PERMISSIONS.GENERATE_THANKS_MAIL,
            PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.EDIT_BASIC_FIELDS, PERMISSIONS.CHANGE_RECRUITER,
            PERMISSIONS.CHANGE_CONTACT, PERMISSIONS.START_DRIVER_TOUR, PERMISSIONS.USE_RECEIVED_DATE_FILTER
        ],
        scopes: { candidates: 'hierarchy', tasks: 'team' }
    },
    lead: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_COMPLETED_TAB,
            PERMISSIONS.MANAGE_USERS, PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW,
            PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.VIEW_MEETING_CONSENT_BANNER, PERMISSIONS.EDIT_CANDIDATE,
            PERMISSIONS.CHANGE_EXPERT, PERMISSIONS.VIEW_RECRUITER_STATS, PERMISSIONS.VIEW_EXPERT_STATS,
            PERMISSIONS.FORMAT_NOTIFICATION_AS_LEAD, PERMISSIONS.VIEW_COMPLAINTS
        ],
        scopes: { candidates: 'team', tasks: 'team' }
    },
    am: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_USER_MANAGEMENT, PERMISSIONS.VIEW_COMPLETED_TAB,
            PERMISSIONS.MANAGE_USERS, PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW,
            PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.CLONE_SUPPORT_TASK, PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
            PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.CHANGE_EXPERT
        ],
        scopes: { candidates: 'team', tasks: 'team' }
    },
    recruiter: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.VIEW_COMPLETED_TAB, PERMISSIONS.CHANGE_PASSWORD,
            PERMISSIONS.VIEW_WHATS_NEW, PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
            PERMISSIONS.CLONE_SUPPORT_TASK, PERMISSIONS.REQUEST_MOCK, PERMISSIONS.GENERATE_THANKS_MAIL,
            PERMISSIONS.EDIT_CANDIDATE, PERMISSIONS.EDIT_BASIC_FIELDS, PERMISSIONS.CHANGE_CONTACT,
            PERMISSIONS.START_DRIVER_TOUR, PERMISSIONS.USE_RECEIVED_DATE_FILTER
        ],
        scopes: { candidates: 'own', tasks: 'own' }
    },
    user: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_BRANCH_CANDIDATES,
            PERMISSIONS.VIEW_RESUME_UNDERSTANDING, PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW,
            PERMISSIONS.MANAGE_MEETINGS, PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
            PERMISSIONS.FILTER_RESUME_EVENTS_BY_EXPERT, PERMISSIONS.UPDATE_RESUME_STATUS_OWN
        ],
        scopes: { candidates: 'own', tasks: 'own' }
    },
    expert: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TASKS, PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
            PERMISSIONS.CHANGE_PASSWORD, PERMISSIONS.VIEW_WHATS_NEW, PERMISSIONS.FILTER_RESUME_EVENTS_BY_EXPERT
        ],
        scopes: { candidates: 'own', tasks: 'own' }
    },
    mtl: {
        permissions: [
            PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_REPORT_ASSISTANT
        ],
        scopes: { candidates: 'own', tasks: 'own' }
    }
};

export class RoleModel {
    constructor() {
        this.collection = null;
        this.cache = new Map(); // Cache roles in memory (rarely change)
    }

    async initialize() {
        this.collection = database.getCollection('roles');

        // Ensure index
        try {
            await this.collection.createIndex({ name: 1 }, { unique: true });
        } catch (error) {
            logger.warn('Role index creation check failed', { error: error.message });
        }

        await this.loadRoles();
        await this.seedDefaults();
        this.setupChangeStream();
    }

    async loadRoles() {
        if (!this.collection) return;
        try {
            const roles = await this.collection.find({}).toArray();
            this.cache.clear();
            for (const role of roles) {
                this.cache.set(role.name, role);
            }
            logger.info(`✅ Loaded ${this.cache.size} roles`);
        } catch (error) {
            logger.error('Failed to load roles', { error: error.message });
        }
    }

    async seedDefaults() {
        if (!this.collection) return;

        try {
            const count = await this.collection.countDocuments();
            if (count > 0) {
                return; // Already initialized
            }

            logger.info('Role collection empty. Seeding default roles...');

            const ops = Object.entries(DEFAULT_ROLES).map(([roleName, config]) => ({
                insertOne: {
                    document: {
                        name: roleName,
                        permissions: config.permissions,
                        scopes: config.scopes,
                        updatedAt: new Date(),
                        createdAt: new Date()
                    }
                }
            }));

            if (ops.length > 0) {
                await this.collection.bulkWrite(ops);
                await this.loadRoles();
                logger.info(`✅ Seeded ${ops.length} default roles`);
            }
        } catch (error) {
            logger.error('Failed to seed default roles', { error: error.message });
        }
    }

    setupChangeStream() {
        if (!this.collection) return;
        try {
            const changeStream = this.collection.watch();
            changeStream.on('change', async (change) => {
                if (change.operationType === 'insert' || change.operationType === 'update' || change.operationType === 'replace') {
                    const doc = change.fullDocument || await this.collection.findOne({ _id: change.documentKey._id });
                    if (doc) {
                        this.cache.set(doc.name, doc);
                        logger.info('🔄 Role cache updated', { role: doc.name });
                    }
                } else if (change.operationType === 'delete') {
                    // We might need to handle delete, but roles shouldn't be deleted often.
                    // Reloading all is safer/easier
                    await this.loadRoles();
                }
            });
        } catch (error) {
            logger.error('Failed to setup role change stream', { error: error.message });
        }
    }

    getRole(roleName) {
        if (!roleName) return null;
        return this.cache.get(roleName.toLowerCase()) || null;
    }

    async updateRole(roleName, updates) {
        if (!this.collection) throw new Error('Role collection not initialized');
        const normalized = roleName.toLowerCase();

        const updateDocs = {
            $set: {
                ...updates,
                updatedAt: new Date()
            }
        };

        const result = await this.collection.updateOne({ name: normalized }, updateDocs);
        // Cache will update via changestream or we can update manually if stream is slow
        return result;
    }

    getAllRoles() {
        return Array.from(this.cache.values());
    }
}

export const roleModel = new RoleModel();
