import React from 'react';
import { FormInput, FormTextarea } from './shared/FormInput';
import { StopForm, StopFormErrors, StopField } from '../utils/missionStopForm';

interface Props { value: StopForm; onChange: (field: StopField, value: string) => void; errors: StopFormErrors; busy: boolean; }

export default function MissionStopFields({ value, onChange, errors, busy }: Props) {
  const field = (key: StopField) => ({ value: value[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(key, event.target.value), error: errors[key], disabled: busy });
  return <fieldset disabled={busy} className="min-w-0 space-y-4">
    <p className="text-sm text-slate-600">Les champs marqués d’un astérisque sont obligatoires.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormInput label="Destinataire" data-autofocus required autoComplete="name" {...field('contactName')} />
      <FormInput label="Téléphone" type="tel" autoComplete="tel" {...field('contactPhone')} />
    </div>
    <FormInput label="Adresse" required autoComplete="street-address" {...field('address')} />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormInput label="Code postal" required inputMode="numeric" autoComplete="postal-code" {...field('postalCode')} />
      <FormInput label="Ville" required autoComplete="address-level2" {...field('city')} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormInput label="Créneau demandé — début" type="time" {...field('timeWindowStart')} />
      <FormInput label="Créneau demandé — fin" type="time" {...field('timeWindowEnd')} />
    </div>
    <FormInput label="Temps sur place (minutes)" type="number" min={1} max={480} step={1} required {...field('serviceTime')} />
    <FormTextarea label="Notes ou instructions" rows={3} {...field('notes')} />
  </fieldset>;
}
