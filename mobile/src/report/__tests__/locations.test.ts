import { type CampusLocation, filterLocations, locationTypeLabel } from '@/report/locations';

// These tests cover pure helpers; the network client is not needed.
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));

const LOCATIONS: CampusLocation[] = [
  { id: '1', name: 'Annie Gabriel Library', location_type: 'building' },
  { id: '2', name: 'Rose Garden', location_type: 'outdoor_area' },
  { id: '3', name: 'Parking Lots', location_type: 'parking' },
];

describe('locationTypeLabel', () => {
  it('turns a type identifier into readable words', () => {
    expect(locationTypeLabel('building')).toBe('Building');
    expect(locationTypeLabel('outdoor_area')).toBe('Outdoor area');
  });

  it('works for types added later as data', () => {
    expect(locationTypeLabel('athletic_field')).toBe('Athletic field');
    expect(locationTypeLabel('')).toBe('');
  });
});

describe('filterLocations', () => {
  it('returns everything for an empty or blank search', () => {
    expect(filterLocations(LOCATIONS, '')).toEqual(LOCATIONS);
    expect(filterLocations(LOCATIONS, '   ')).toEqual(LOCATIONS);
  });

  it('matches part of the name, ignoring case', () => {
    expect(filterLocations(LOCATIONS, 'LIBR').map((item) => item.id)).toEqual(['1']);
    expect(filterLocations(LOCATIONS, ' garden ').map((item) => item.id)).toEqual(['2']);
  });

  it('matches the location type', () => {
    expect(filterLocations(LOCATIONS, 'outdoor').map((item) => item.id)).toEqual(['2']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterLocations(LOCATIONS, 'stadium')).toEqual([]);
  });
});
