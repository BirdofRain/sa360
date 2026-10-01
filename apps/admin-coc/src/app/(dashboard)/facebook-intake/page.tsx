import { FacebookIntakePanel } from "@/components/facebook-intake/facebook-intake-panel";
import {
  associateFacebookFormAction,
  reevaluateFacebookCaptureAction,
} from "@/app/actions/facebook-intake";
import { listFacebookFormAssociations } from "@/lib/admin-api/facebook-intake-server";

export default async function FacebookIntakePage() {
  const listed = await listFacebookFormAssociations();
  return (
    <FacebookIntakePanel
      associations={listed.items}
      loadError={listed.error}
      associateAction={associateFacebookFormAction}
      reevaluateAction={reevaluateFacebookCaptureAction}
    />
  );
}
