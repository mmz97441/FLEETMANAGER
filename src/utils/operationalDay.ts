/** Delivery operations use Réunion time, independently of the phone's timezone. */
export const operationalDay = (date = new Date()): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
