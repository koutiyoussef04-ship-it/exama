/**
 * B2B owner dashboard (GET/PATCH /b2b-admin/*): organizations, plans, usage and failures across every
 * organization. Only the B2B owner (an organization account with b2b_role = owner, granted by the server-side
 * provisioning command) can call these endpoints; the student owner dashboard (/admin) is separate.
 */
import type { OrganizationRole } from './organizations';
import type { AdminOrganization, OrganizationPlan } from './organizations';

export type B2BOverview = {
  organizations: {
    total: number;
    active: number;
    suspended: number;
    byPlan: Record<OrganizationPlan, number>;
    pilotsActive: number;
    pilotsExpired: number;
    /** Pilots ending within the next 7 days. */
    pilotsEndingSoon: number;
    /** Organizations with no active plan (`none`): waiting for a plan or a pilot. */
    withoutPlan: number;
  };
  accounts: { organizationAccounts: number; verified: number; withoutOrganization: number; signupsLast30Days: number };
  /** Calendar month (UTC), all organizations. `aiCostMicroUsd` null when some calls had no price. */
  usageThisMonth: { courses: number; drafts: number; aiCostMicroUsd: number | null };
  content: { courses: number; failedCourses: number; drafts: number; approved: number; rejected: number };
  /** Last 30 days, all organizations: failed AI calls (by error category) and courses that failed processing. */
  operations: { aiErrorsLast30Days: number; failedCoursesLast30Days: number };
  generatedAt: string;
};

export type B2BOrganizationRow = AdminOrganization & {
  /** Latest usage-ledger entry (course upload or drafts), or null. */
  lastActivityAt: string | null;
  failedCourses: number;
  /** Failed AI calls for this organization in the last 30 days. */
  aiErrorsLast30Days: number;
};

export type B2BOrganizationDetail = B2BOrganizationRow & {
  members: { userId: string; email: string; name: string; role: OrganizationRole; joinedAt: string; emailVerified: boolean }[];
  courses: { id: string; title: string; status: string; errorCode: string | null; pageCount: number | null; createdAt: string }[];
  /** The 30 latest usage-ledger entries. */
  activity: { at: string; kind: string; amount: number; userEmail: string | null }[];
  /** The 20 latest failed AI calls: when, which feature, the provider-neutral error category (never a message). */
  aiErrors: { at: string; feature: string; errorCode: string | null }[];
};

export type B2BAccountRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  b2bRole: 'owner' | null;
  organizations: { id: string; name: string; role: OrganizationRole }[];
};
