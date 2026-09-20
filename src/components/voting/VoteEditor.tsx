import React, { useState } from "react";
import Modal from "../shared/Modal";
import type { VoteDraft, VotePerson, VotePoll } from "../../types/voting";
import { fromReunionInput, toReunionInput } from "../../utils/voting";
import VotePrivacyNotice from './VotePrivacyNotice';

const labelClass = "block space-y-1 text-sm font-semibold text-slate-800";
function PeoplePicker({
  label,
  people,
  selected,
  onChange,
}: {
  label: string;
  people: VotePerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = people.filter((p) =>
    `${p.name} ${p.role}`
      .toLocaleLowerCase("fr")
      .includes(query.toLocaleLowerCase("fr")),
  );
  return (
    <fieldset className="rounded-xl border border-slate-200 p-3 space-y-2">
      <legend className="px-1 font-bold">
        {label} · {selected.length}
      </legend>
      <input
        aria-label={`Rechercher dans ${label.toLowerCase()}`}
        className="ui-input w-full"
        placeholder="Rechercher un salarié"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="ui-button ui-button-secondary"
          onClick={() => onChange(people.map((p) => p.id))}
        >
          Tout sélectionner
        </button>
        <button
          type="button"
          className="ui-button ui-button-ghost"
          onClick={() => onChange([])}
        >
          Tout désélectionner
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
        {shown.map((person) => (
          <label
            key={person.id}
            className="flex items-center gap-3 min-h-12 py-2 cursor-pointer"
          >
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={selected.includes(person.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, person.id]
                    : selected.filter((id) => id !== person.id),
                )
              }
            />
            <span className="min-w-0 break-words">
              <span className="block font-semibold">{person.name}</span>
              <span className="text-sm text-slate-600">{person.role}</span>
            </span>
          </label>
        ))}
        {!shown.length && (
          <p className="py-3 text-sm text-slate-600">
            Aucun salarié dans cette sélection.
          </p>
        )}
      </div>
    </fieldset>
  );
}

export default function VoteEditor({
  employees,
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  employees: VotePerson[];
  initial?: VotePoll;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (value: VoteDraft) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [value, setValue] = useState<VoteDraft>(() =>
    initial
      ? {
          title: initial.title,
          purpose: initial.purpose,
          question: initial.question,
          kind: initial.kind,
          privacy: "secret",
          opensAt: initial.opensAt,
          closesAt: initial.closesAt,
          participantIds: initial.participantIds || [],
          voterIds: initial.voterIds || [],
          options: initial.options,
          maxChoices: initial.maxChoices,
          allowBlank: initial.allowBlank,
          quorumPercent: initial.quorumPercent,
        }
      : {
          title: "",
          purpose: "",
          question: "",
          kind: "consultation",
          privacy: "secret",
          opensAt: new Date().toISOString(),
          closesAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          participantIds: employees.map((p) => p.id),
          voterIds: employees.map((p) => p.id),
          options: [
            { id: crypto.randomUUID(), label: "Pour" },
            { id: crypto.randomUUID(), label: "Contre" },
          ],
          maxChoices: 1,
          allowBlank: true,
          quorumPercent: 0,
        },
  );
  const set = (patch: Partial<VoteDraft>) => {
    setDirty(true);
    setValue((v) => ({ ...v, ...patch }));
  };
  const participants = employees.filter((p) =>
    value.participantIds.includes(p.id),
  );
  const updateParticipants = (participantIds: string[]) =>
    set({
      participantIds,
      voterIds: value.voterIds.filter((id) => participantIds.includes(id)),
      ...(value.kind === "election"
        ? {
            options: value.options.filter((o) =>
              participantIds.includes(o.employeeId!),
            ),
          }
        : {}),
    });
  return (
    <Modal
      isOpen
      title={initial ? "Modifier le brouillon" : "Préparer un vote"}
      subtitle="Consultation interne ou élection simple · Les règles seront figées à la publication."
      size="3xl"
      mobileFullscreen
      busy={busy}
      dirty={dirty}
      onClose={onClose}
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="space-y-4">
          <legend className="text-lg font-bold mb-3">
            1. Pourquoi vote-t-on ?
          </legend>
          <label className={labelClass}>
            Titre du vote
            <input
              required
              maxLength={160}
              className="ui-input w-full"
              value={value.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Ex. Choix des horaires de réunion"
            />
          </label>
          <label className={labelClass}>
            Objet et explications
            <textarea
              required
              maxLength={5000}
              rows={4}
              className="ui-input w-full"
              value={value.purpose}
              onChange={(e) => set({ purpose: e.target.value })}
              placeholder="Expliquez la décision à prendre et ce qui changera après le vote."
            />
          </label>
          <label className={labelClass}>
            Question posée aux électeurs
            <textarea
              required
              maxLength={1000}
              rows={2}
              className="ui-input w-full"
              value={value.question}
              onChange={(e) => set({ question: e.target.value })}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Type de scrutin
              <select
                className="ui-input w-full"
                value={value.kind}
                onChange={(e) =>
                  set({
                    kind: e.target.value as VoteDraft["kind"],
                    options:
                      e.target.value === "election"
                        ? []
                        : [
                            { id: crypto.randomUUID(), label: "Pour" },
                            { id: crypto.randomUUID(), label: "Contre" },
                          ],
                    maxChoices: 1,
                  })
                }
              >
                <option value="consultation">Consultation interne</option>
                <option value="election">Élection interne simple</option>
              </select>
            </label>
            <p className="text-sm font-semibold self-center">Confidentialité : vote secret obligatoire</p>
          </div>
          <VotePrivacyNotice privacy="secret" />
        </fieldset>
        <fieldset disabled={busy} className="space-y-4">
          <legend className="text-lg font-bold mb-3">
            2. Qui participe et qui vote ?
          </legend>
          <p className="text-sm text-slate-600">
            Les participants consultent le scrutin et ses documents. Seuls les
            électeurs peuvent déposer un bulletin.
          </p>
          <PeoplePicker
            label="Participants"
            people={employees}
            selected={value.participantIds}
            onChange={updateParticipants}
          />
          <PeoplePicker
            label="Électeurs"
            people={participants}
            selected={value.voterIds}
            onChange={(voterIds) => set({ voterIds })}
          />
        </fieldset>
        <fieldset disabled={busy} className="space-y-4">
          <legend className="text-lg font-bold mb-3">
            3.{" "}
            {value.kind === "election"
              ? "Qui sont les candidats ?"
              : "Quels sont les choix ?"}
          </legend>
          {value.kind === "election" ? (
            <PeoplePicker
              label="Candidats"
              people={participants}
              selected={value.options.map((o) => o.employeeId!)}
              onChange={(selected) =>
                set({
                  options: selected.map(
                    (employeeId) =>
                      value.options.find(
                        (o) => o.employeeId === employeeId,
                      ) || {
                        id: crypto.randomUUID(),
                        employeeId,
                        label: employees.find((p) => p.id === employeeId)!.name,
                      },
                  ),
                  maxChoices: Math.min(
                    value.maxChoices,
                    Math.max(1, selected.length),
                  ),
                })
              }
            />
          ) : (
            <div className="space-y-2">
              {value.options.map((option, index) => (
                <div key={option.id} className="flex gap-2 items-start">
                  <label className={`${labelClass} flex-1 min-w-0`}>
                    Choix {index + 1}
                    <input
                      required
                      maxLength={160}
                      className="ui-input w-full"
                      value={option.label}
                      onChange={(e) =>
                        set({
                          options: value.options.map((o) =>
                            o.id === option.id
                              ? { ...o, label: e.target.value }
                              : o,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Retirer le choix ${index + 1}`}
                    className="ui-button ui-button-ghost mt-6"
                    disabled={value.options.length <= 2}
                    onClick={() =>
                      set({
                        options: value.options.filter(
                          (o) => o.id !== option.id,
                        ),
                        maxChoices: Math.min(
                          value.maxChoices,
                          value.options.length - 1,
                        ),
                      })
                    }
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={value.options.length >= 50}
                className="ui-button ui-button-secondary"
                onClick={() =>
                  set({
                    options: [
                      ...value.options,
                      { id: crypto.randomUUID(), label: "" },
                    ],
                  })
                }
              >
                Ajouter un choix
              </button>
            </div>
          )}
          <p className="text-sm text-slate-600">
            {value.kind === "election"
              ? "Sélectionnez au moins un candidat (50 maximum)."
              : "Prévoyez au moins deux choix distincts (50 maximum)."}
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className={labelClass}>
              Nombre maximum de choix par électeur
              <input
                type="number"
                required
                min={1}
                max={Math.max(1, value.options.length)}
                className="ui-input w-full"
                value={value.maxChoices}
                onChange={(e) => set({ maxChoices: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-3 min-h-12">
              <input
                className="h-5 w-5"
                type="checkbox"
                checked={value.allowBlank}
                onChange={(e) => set({ allowBlank: e.target.checked })}
              />
              Autoriser le vote blanc
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="space-y-4">
          <legend className="text-lg font-bold mb-3">
            4. Quand vote-t-on ?
          </legend>
          <p className="text-sm text-slate-600">
            Toutes les heures sont celles de La Réunion.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Ouverture
              <input
                required
                type="datetime-local"
                className="ui-input w-full"
                value={value.opensAt ? toReunionInput(value.opensAt) : ""}
                onChange={(e) =>
                  set({ opensAt: fromReunionInput(e.target.value) })
                }
              />
            </label>
            <label className={labelClass}>
              Fin du vote
              <input
                required
                type="datetime-local"
                className="ui-input w-full"
                value={value.closesAt ? toReunionInput(value.closesAt) : ""}
                onChange={(e) =>
                  set({ closesAt: fromReunionInput(e.target.value) })
                }
              />
            </label>
            <label className={labelClass}>
              Participation minimale demandée (%)
              <input
                type="number"
                required
                min={0}
                max={100}
                className="ui-input w-full"
                value={value.quorumPercent}
                onChange={(e) => set({ quorumPercent: Number(e.target.value) })}
              />
              <span className="text-sm font-normal text-slate-600">
                0 = aucun quorum. Les votes blancs comptent dans la
                participation.
              </span>
            </label>
          </div>
        </fieldset>
        <p className="rounded-xl bg-slate-50 p-3 text-sm">
          Enregistrez le brouillon pour joindre des documents et vérifier le
          récapitulatif avant publication.
        </p>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            className="ui-button ui-button-secondary"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="ui-button ui-button-primary"
          >
            {busy ? "Enregistrement…" : "Enregistrer le brouillon"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
