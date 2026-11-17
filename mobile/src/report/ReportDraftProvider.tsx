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
  /**
   * Id of the photo once it is in protected storage, so a retried submission
   * does not upload it again. Cleared whenever the photo changes.
   */
  uploadedMediaId: string | null;
  setUploadedMediaId: (id: string | null) => void;
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
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);

  const choosePhoto = useCallback((next: ReportPhoto | null) => {
    setPhoto(next);
    setUploadedMediaId(null);
  }, []);

  const reset = useCallback(() => {
    setPhoto(null);
    setNote('');
    setLocation(null);
    setUploadedMediaId(null);
  }, []);

  const value = useMemo<ReportDraft>(
    () => ({
      photo,
      note,
      location,
      uploadedMediaId,
      setUploadedMediaId,
      setPhoto: choosePhoto,
      setNote,
      setLocation,
      reset,
    }),
    [photo, note, location, uploadedMediaId, choosePhoto, reset],
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
