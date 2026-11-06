export type MetaCaptureHealthPage = {
  pageId: string;
  pageName: string | null;
  captureEnabled: boolean;
  credentialId: string;
  credentialKind: string;
  credentialStatus: string;
  tokenFingerprint: string;
  expiresAt: string | null;
  scopes: string[];
  lastDiagnostic: string | null;
};

export type MetaCaptureHealthView = {
  flags: {
    intakeEnabled: boolean;
    graphFetchEnabled: boolean;
    routingEnabled: boolean;
    captureAssociationEnabled: boolean;
    unboundPageTokenEnabled: boolean;
    inventoryDiscoveryEnabled: boolean;
    encryptionConfigured: boolean;
    envTokenConfigured: boolean;
    envTokenPageId: string | null;
  };
  pages: MetaCaptureHealthPage[];
  review: {
    adminReviewUnmatched: number;
    associationDisabled: number;
    captureNotAllowlisted: number;
    candidateForms: number;
  };
};

const SECRET_KEY = /token|secret|cipher|password|proof/i;

/** Drop anything that could carry a Meta token before it reaches the browser. */
export function sanitizeMetaCaptureHealth(value: unknown): MetaCaptureHealthView | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const flags = root.flags;
  const review = root.review;
  if (!flags || typeof flags !== "object" || !review || typeof review !== "object") return null;
  const flagRec = flags as Record<string, unknown>;
  const reviewRec = review as Record<string, unknown>;
  const credentials = Array.isArray(root.credentials) ? root.credentials : [];
  const pages: MetaCaptureHealthPage[] = [];
  for (const credential of credentials) {
    if (!credential || typeof credential !== "object") continue;
    const cred = credential as Record<string, unknown>;
    if (Object.keys(cred).some((key) => SECRET_KEY.test(key) && key !== "tokenFingerprint")) continue;
    const grants = Array.isArray(cred.pages) ? cred.pages : [];
    for (const grant of grants) {
      if (!grant || typeof grant !== "object") continue;
      const page = grant as Record<string, unknown>;
      if (typeof page.pageId !== "string") continue;
      pages.push({
        pageId: page.pageId,
        pageName: typeof page.pageName === "string" ? page.pageName : null,
        captureEnabled: page.captureEnabled === true,
        credentialId: typeof cred.id === "string" ? cred.id : "",
        credentialKind: typeof cred.kind === "string" ? cred.kind : "",
        credentialStatus: typeof cred.status === "string" ? cred.status : "",
        tokenFingerprint: typeof cred.tokenFingerprint === "string" ? cred.tokenFingerprint : "",
        expiresAt: typeof cred.expiresAt === "string" ? cred.expiresAt : null,
        scopes: Array.isArray(cred.scopes) ? cred.scopes.filter((item): item is string => typeof item === "string") : [],
        lastDiagnostic: typeof cred.lastDiagnostic === "string" ? cred.lastDiagnostic : null,
      });
    }
  }
  const bool = (key: string) => flagRec[key] === true;
  const count = (key: string) => (typeof reviewRec[key] === "number" ? reviewRec[key] : 0);
  return {
    flags: {
      intakeEnabled: bool("intakeEnabled"),
      graphFetchEnabled: bool("graphFetchEnabled"),
      routingEnabled: bool("routingEnabled"),
      captureAssociationEnabled: bool("captureAssociationEnabled"),
      unboundPageTokenEnabled: bool("unboundPageTokenEnabled"),
      inventoryDiscoveryEnabled: bool("inventoryDiscoveryEnabled"),
      encryptionConfigured: bool("encryptionConfigured"),
      envTokenConfigured: bool("envTokenConfigured"),
      envTokenPageId: typeof flagRec.envTokenPageId === "string" ? flagRec.envTokenPageId : null,
    },
    pages,
    review: {
      adminReviewUnmatched: count("adminReviewUnmatched"),
      associationDisabled: count("associationDisabled"),
      captureNotAllowlisted: count("captureNotAllowlisted"),
      candidateForms: count("candidateForms"),
    },
  };
}
