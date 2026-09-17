import { useEffect, useState } from 'react';
import { operationalDay } from '../utils/operationalDay';
export function useOperationalDay() {
  const [day, setDay] = useState(operationalDay);
  useEffect(() => {
    const refresh = () => setDay(operationalDay());
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return day;
}
