export type TeamAccessLevel = "administrator" | "manager" | "operations";

export type TeamAccountStatus =
  | "disabled"
  | "active"
  | "revoked"
  | "pending"
  | "invitation_expired"
  | "invitation_canceled";

export type TeamInvitationStatus = "none" | "pending" | "expired" | "consumed" | "canceled";

export type TeamMember = {
  staffPrincipalId: string;
  email: string;
  displayName: string | null;
  accountStatus: TeamAccountStatus;
  invitationStatus: TeamInvitationStatus;
  accessLevel: TeamAccessLevel | "none";
  permissions: string[];
  bound: boolean;
  lastLoginAt: string | null;
  invitationExpiresAt: string | null;
  emailDelivery: "sent" | "not_sent" | "unknown";
};

export type TeamActivityEntry = {
  id: string;
  kind: string;
  detail: string | null;
  actorStaffPrincipalId: string | null;
  createdAt: string;
};

export type TeamMemberDetail = {
  member: TeamMember;
  activity: TeamActivityEntry[];
};

export type TeamMutationResult =
  | { ok: true; member: TeamMember; message: string }
  | { ok: false; message: string };
