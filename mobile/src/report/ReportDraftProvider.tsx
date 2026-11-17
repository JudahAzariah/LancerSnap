import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { CampusLocation } from '@/report/locations';
import type { ReportPhoto } from '@/report/photo';

/**
 * The report a student is in the middle of creating. It lives only in memory
 * while they move between the steps of the reporting flow; nothing is sent
 * anywhere until they submit.
 *
 * Deliberately has no "responsible office" field: students never choose who
 * handles a report (DD-02).
 */
type ReportDraft = {
  photo: ReportPhoto | null;
  note: string;
  /** The supported campus location the student selected (US-06). */
  location: CampusLocation | null;
  setPhoto: (photo: ReportPhoto | null) => void;
  setNote: (note: string) => void;
  setLocation: (location: CampusLocation | null) => void;
  reset: () => void;
};

const ReportDraftContext = createContext<ReportDraft | null>(null);

export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const [photo, setPhoto] = useState<ReportPhoto | null>(null);
  const [note, setNote] = useState('');
  const [location, setLocation] = useState<CampusLocation | null>(null);

  const reset = useCallback(() => {
    setPhoto(null);
    setNote('');
    setLocation(null);
  }, []);

  const value = useMemo<ReportDraft>(
    () => ({ photo, note, location, setPhoto, setNote, setLocation, reset }),
    [photo, note, location, reset],
  );

  return <ReportDraftContext.Provider value={value}>{children}</ReportDraftContext.Provider>;
}

export function useReportDraft(): ReportDraft {
  const value = useContext(ReportDraftContext);
  if (!value) {
    throw new Error('useReportDraft must be used inside <ReportDraftProvider>');
  }
  return value;
}
