/**
 * Campus locations for the reporting flow (US-06).
 *
 * The student picks from the supported list the backend provides. The app
 * never asks for device location, so there is no GPS or background tracking
 * (SDD section 2.4, POLICY section 9).
 */
import { apiFetch } from '@/lib/api';

export type CampusLocation = {
  id: string;
  name: string;
  /** Lower-case identifier such as "building" or "outdoor_area". */
  location_type: string;
};

export function fetchLocations(): Promise<CampusLocation[]> {
  return apiFetch<CampusLocation[]>('/locations');
}

/** "outdoor_area" -> "Outdoor area". Works for types added later as data. */
export function locationTypeLabel(locationType: string): string {
  const words = locationType.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** Case-insensitive match on the name or the type; an empty query matches all. */
export function filterLocations(locations: CampusLocation[], query: string): CampusLocation[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return locations;
  return locations.filter(
    (location) =>
      location.name.toLowerCase().includes(needle) ||
      locationTypeLabel(location.location_type).toLowerCase().includes(needle),
  );
}
