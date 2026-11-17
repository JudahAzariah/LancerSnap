/**
 * LancerSnap must not track device location (SDD section 2.4, POLICY section 9).
 * Location comes only from the campus location the student selects. These
 * checks fail if a location library or permission is ever added.
 */
import appConfig from '../../app.json';
import packageJson from '../../package.json';

const LOCATION_PACKAGES = [
  'expo-location',
  'expo-task-manager',
  'expo-background-fetch',
  'react-native-geolocation-service',
  '@react-native-community/geolocation',
  'react-native-background-geolocation',
];

describe('device location is never requested', () => {
  it('has no location or background-tracking library installed', () => {
    const installed = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });
    for (const name of LOCATION_PACKAGES) {
      expect(installed).not.toContain(name);
    }
  });

  it('declares no location permission or location plugin in the app config', () => {
    const config = JSON.stringify(appConfig).toLowerCase();
    for (const marker of [
      'expo-location',
      'access_fine_location',
      'access_coarse_location',
      'access_background_location',
      'nslocation',
      'uibackgroundmodes',
    ]) {
      expect(config).not.toContain(marker);
    }
  });
});
