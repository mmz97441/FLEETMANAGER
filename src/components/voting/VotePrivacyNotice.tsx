import type { VotePrivacy } from "../../types/voting";

export default function VotePrivacyNotice({
  privacy,
}: {
  privacy: VotePrivacy;
}) {
  return privacy === "secret" ? (
    <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-950 space-y-2">
      <p className="font-bold">Vote secret : votre choix est protégé</p>
      <p>
        Votre choix n’est pas enregistré avec votre nom. La direction reçoit les
        résultats globaux et la liste des personnes ayant voté, sans accès à
        leur choix individuel dans l’application.
      </p>
      <p>
        Seules les personnes autorisées peuvent voter. Un seul bulletin est
        accepté par personne, même en cas de double clic.
      </p>
      <details>
        <summary className="min-h-11 flex items-center cursor-pointer font-semibold">
          Comprendre la confidentialité
        </summary>
        <p>
          La participation est connue, mais les choix restent séparés des
          identités. Un résultat unanime ou un très petit groupe peut toutefois
          permettre des déductions. Cette protection ne constitue pas une
          garantie d’anonymat absolu vis-à-vis de l’administrateur technique.
        </p>
      </details>
    </div>
  ) : (
    <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950 space-y-2">
      <p className="font-bold">Vote nominatif : scrutin existant</p>
      <p>
        Ce scrutin a été publié en mode nominatif. Après clôture, votre choix
        sera visible par la direction. Il ne s’agit pas d’un vote secret.
      </p>
    </div>
  );
}
