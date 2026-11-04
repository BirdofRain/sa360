import { FacebookIntakePanel } from "@/components/facebook-intake/facebook-intake-panel";
import {
  associateFacebookFormAction,
  reevaluateFacebookCaptureAction,
} from "@/app/actions/facebook-intake";
import { listFacebookFormAssociations, loadMetaCaptureHealth } from "@/lib/admin-api/facebook-intake-server";

export default async function FacebookIntakePage() {
  const [listed, health] = await Promise.all([listFacebookFormAssociations(), loadMetaCaptureHealth()]);
  return (
    <FacebookIntakePanel
      associations={listed.items}
      loadError={listed.error}
      associateAction={associateFacebookFormAction}
      reevaluateAction={reevaluateFacebookCaptureAction}
      captureHealth={health.health}
      captureHealthError={health.error}
    />
  );
}
