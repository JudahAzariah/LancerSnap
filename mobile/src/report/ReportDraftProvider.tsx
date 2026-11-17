import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

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
  setPhoto: (photo: ReportPhoto | null) => void;
  setNote: (note: string) => void;
  reset: () => void;
};

const ReportDraftContext = createContext<ReportDraft | null>(null);

export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const [photo, setPhoto] = useState<ReportPhoto | null>(null);
  const [note, setNote] = useState('');

  const reset = useCallback(() => {
    setPhoto(null);
    setNote('');
  }, []);

  const value = useMemo<ReportDraft>(
    () => ({ photo, note, setPhoto, setNote, reset }),
    [photo, note, reset],
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
